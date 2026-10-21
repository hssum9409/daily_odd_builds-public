import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';

// Direct OS Keychain calls keep credentials out of command arguments and disk.
// No Swift/Xcode or third-party credential helper is required on an installed Mac.
class MacKeychain {
  MacKeychain() {
    if (!Platform.isMacOS) throw const FormatException('unsupported-platform');
  }
  final cf = DynamicLibrary.open(
    '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation',
  );
  final security = DynamicLibrary.open(
    '/System/Library/Frameworks/Security.framework/Security',
  );
  late final createDictionary = cf
      .lookupFunction<
        Pointer<Void> Function(
          Pointer<Void>,
          IntPtr,
          Pointer<Void>,
          Pointer<Void>,
        ),
        Pointer<Void> Function(Pointer<Void>, int, Pointer<Void>, Pointer<Void>)
      >('CFDictionaryCreateMutable');
  late final set = cf
      .lookupFunction<
        Void Function(Pointer<Void>, Pointer<Void>, Pointer<Void>),
        void Function(Pointer<Void>, Pointer<Void>, Pointer<Void>)
      >('CFDictionarySetValue');
  late final string = cf
      .lookupFunction<
        Pointer<Void> Function(Pointer<Void>, Pointer<Utf8>, Uint32),
        Pointer<Void> Function(Pointer<Void>, Pointer<Utf8>, int)
      >('CFStringCreateWithCString');
  late final data = cf
      .lookupFunction<
        Pointer<Void> Function(Pointer<Void>, Pointer<Uint8>, IntPtr),
        Pointer<Void> Function(Pointer<Void>, Pointer<Uint8>, int)
      >('CFDataCreate');
  late final length = cf
      .lookupFunction<
        IntPtr Function(Pointer<Void>),
        int Function(Pointer<Void>)
      >('CFDataGetLength');
  late final bytes = cf
      .lookupFunction<
        Pointer<Uint8> Function(Pointer<Void>),
        Pointer<Uint8> Function(Pointer<Void>)
      >('CFDataGetBytePtr');
  late final release = cf
      .lookupFunction<
        Void Function(Pointer<Void>),
        void Function(Pointer<Void>)
      >('CFRelease');
  late final add = security
      .lookupFunction<
        Int32 Function(Pointer<Void>, Pointer<Pointer<Void>>),
        int Function(Pointer<Void>, Pointer<Pointer<Void>>)
      >('SecItemAdd');
  late final update = security
      .lookupFunction<
        Int32 Function(Pointer<Void>, Pointer<Void>),
        int Function(Pointer<Void>, Pointer<Void>)
      >('SecItemUpdate');
  late final get = security
      .lookupFunction<
        Int32 Function(Pointer<Void>, Pointer<Pointer<Void>>),
        int Function(Pointer<Void>, Pointer<Pointer<Void>>)
      >('SecItemCopyMatching');
  late final remove = security
      .lookupFunction<
        Int32 Function(Pointer<Void>),
        int Function(Pointer<Void>)
      >('SecItemDelete');
  Pointer<Void> constant(String name) =>
      security.lookup<Pointer<Void>>(name).value;
  Pointer<Void> dictionary() => createDictionary(
    nullptr,
    0,
    cf.lookup<Void>('kCFTypeDictionaryKeyCallBacks'),
    cf.lookup<Void>('kCFTypeDictionaryValueCallBacks'),
  );
  void text(Pointer<Void> dict, String key, String value) {
    final utf = value.toNativeUtf8(), v = string(nullptr, utf, 0x08000100);
    calloc.free(utf);
    if (v == nullptr) throw const FormatException('credential-storage');
    set(dict, constant(key), v);
    release(v);
  }

  String command(String command, String account, [String? input]) {
    final query = dictionary();
    if (query == nullptr) throw const FormatException('credential-storage');
    try {
      set(query, constant('kSecClass'), constant('kSecClassGenericPassword'));
      text(query, 'kSecAttrService', 'DailyOddBuilds.TokenScale');
      text(query, 'kSecAttrAccount', account);
      if (command == 'delete') {
        final status = remove(query);
        if (status != 0 && status != -25300) {
          throw const FormatException('credential-storage');
        }
        return '';
      }
      if (command == 'get') {
        set(
          query,
          constant('kSecReturnData'),
          cf.lookup<Pointer<Void>>('kCFBooleanTrue').value,
        );
        set(query, constant('kSecMatchLimit'), constant('kSecMatchLimitOne'));
        final result = calloc<Pointer<Void>>();
        try {
          if (get(query, result) != 0 || result.value == nullptr) {
            throw const FormatException('credential-storage');
          }
          final value = result.value;
          try {
            final count = length(value);
            if (count < 1 || count > 32768) {
              throw const FormatException('credential-storage');
            }
            return utf8.decode(bytes(value).asTypedList(count));
          } finally {
            release(value);
          }
        } finally {
          calloc.free(result);
        }
      }
      if (command != 'set' || input == null) {
        throw const FormatException('credential-storage');
      }
      final encoded = utf8.encode(input);
      if (encoded.isEmpty || encoded.length > 32768) {
        throw const FormatException('credential-storage');
      }
      final buffer = calloc<Uint8>(encoded.length), attributes = dictionary();
      buffer.asTypedList(encoded.length).setAll(0, encoded);
      final value = data(nullptr, buffer, encoded.length);
      calloc.free(buffer);
      try {
        set(attributes, constant('kSecValueData'), value);
        var status = update(query, attributes);
        if (status == -25300) {
          set(query, constant('kSecValueData'), value);
          set(
            query,
            constant('kSecAttrAccessible'),
            constant('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly'),
          );
          status = add(query, nullptr);
        }
        if (status != 0) throw const FormatException('credential-storage');
      } finally {
        release(value);
        release(attributes);
      }
      return '';
    } finally {
      release(query);
    }
  }
}
