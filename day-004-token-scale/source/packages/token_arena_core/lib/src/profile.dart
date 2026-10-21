/// Built-in vector parts only. No file, URL, or user-provided drawing is stored.
class AvatarSpec {
  const AvatarSpec({
    this.shape = 'round',
    this.eyes = 'dot',
    this.mouth = 'smile',
    this.accessory = 'none',
    this.background = '#E5F5EE',
    this.body = '#FFB85C',
    this.accent = '#087F5B',
  });
  static const shapes = ['round', 'squircle', 'flame', 'pixel'];
  static const eyeStyles = ['dot', 'happy', 'sleepy', 'star'];
  static const mouths = ['smile', 'grin', 'o'];
  static const accessories = ['none', 'crown', 'headphones', 'sprout'];
  static const keys = [
    'v',
    'shape',
    'eyes',
    'mouth',
    'accessory',
    'background',
    'body',
    'accent',
  ];
  final String shape, eyes, mouth, accessory, background, body, accent;
  factory AvatarSpec.fromJson(Object? value) {
    if (value == null) return const AvatarSpec();
    if (value is! Map ||
        value.length != keys.length ||
        !value.keys.every(keys.contains) ||
        value['v'] != 1 ||
        !shapes.contains(value['shape']) ||
        !eyeStyles.contains(value['eyes']) ||
        !mouths.contains(value['mouth']) ||
        !accessories.contains(value['accessory']) ||
        !['background', 'body', 'accent'].every(
          (k) =>
              value[k] is String &&
              RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(value[k]),
        )) {
      throw const FormatException('invalid-avatar');
    }
    return AvatarSpec(
      shape: value['shape'],
      eyes: value['eyes'],
      mouth: value['mouth'],
      accessory: value['accessory'],
      background: value['background'].toUpperCase(),
      body: value['body'].toUpperCase(),
      accent: value['accent'].toUpperCase(),
    );
  }
  Map<String, dynamic> toJson() => {
    'v': 1,
    'shape': shape,
    'eyes': eyes,
    'mouth': mouth,
    'accessory': accessory,
    'background': background,
    'body': body,
    'accent': accent,
  };
  AvatarSpec copyWith({
    String? shape,
    String? eyes,
    String? mouth,
    String? accessory,
    String? background,
    String? body,
    String? accent,
  }) => AvatarSpec.fromJson({
    ...toJson(),
    'shape': ?shape,
    'eyes': ?eyes,
    'mouth': ?mouth,
    'accessory': ?accessory,
    'background': ?background,
    'body': ?body,
    'accent': ?accent,
  });
}

String normalizeBio(String input) {
  final value = input.trim();
  if (value.length > 100 || RegExp(r'[<>\x00-\x1f\x7f]').hasMatch(value)) {
    throw const FormatException('invalid-bio');
  }
  return value;
}

String normalizeGithub(String input) {
  var value = input.trim();
  if (value.isEmpty) return '';
  if (value.startsWith('https://')) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.host != 'github.com' ||
        uri.userInfo.isNotEmpty ||
        uri.hasPort ||
        uri.hasQuery ||
        uri.hasFragment ||
        uri.pathSegments.where((s) => s.isNotEmpty).length != 1) {
      throw const FormatException('invalid-github');
    }
    value = uri.pathSegments.first;
  }
  if (value.length > 39 ||
      value.contains('--') ||
      !RegExp(r'^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$').hasMatch(value)) {
    throw const FormatException('invalid-github');
  }
  return value;
}

class ProfileCustomization {
  const ProfileCustomization({
    this.avatar = const AvatarSpec(),
    this.bio = '',
    this.github = '',
  });
  final AvatarSpec avatar;
  final String bio, github;
  factory ProfileCustomization.fromProfile(Map<String, dynamic>? profile) =>
      ProfileCustomization(
        avatar: AvatarSpec.fromJson(profile?['avatar']),
        bio: normalizeBio(profile?['bio'] as String? ?? ''),
        github: normalizeGithub(profile?['github'] as String? ?? ''),
      );
  Map<String, dynamic> toJson() => {
    'avatar': AvatarSpec.fromJson(avatar.toJson()).toJson(),
    'bio': normalizeBio(bio),
    'github': normalizeGithub(github),
  };
  Uri? get githubUrl => github.isEmpty
      ? null
      : Uri.https('github.com', '/${normalizeGithub(github)}');
}
