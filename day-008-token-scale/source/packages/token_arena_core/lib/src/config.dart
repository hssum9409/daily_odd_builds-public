class ArenaConfig {
  static const projectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
    defaultValue: 'token-arena-hssum9409',
  );
  static const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const senderId = String.fromEnvironment(
    'FIREBASE_SENDER_ID',
    defaultValue: '169786540729',
  );
  static const webUrl = String.fromEnvironment(
    'ARENA_WEB_URL',
    defaultValue: 'http://localhost:7354',
  );
  static const emulator = bool.fromEnvironment('ARENA_EMULATOR');
  static const apiUrl = String.fromEnvironment('ARENA_API_URL');
  static const databaseUrl = String.fromEnvironment('ARENA_DATABASE_URL');
  static String get effectiveApiUrl => apiUrl.isNotEmpty
      ? apiUrl
      : emulator
      ? 'http://127.0.0.1:5004/$projectId/asia-northeast3/arenaApi'
      : '';
  static String get effectiveDatabaseUrl => databaseUrl.isNotEmpty
      ? databaseUrl
      : emulator
      ? 'https://$projectId-default-rtdb.firebaseio.com'
      : '';
  // Operator-controlled launch switch; this does not imply OpenAI approval.
  static const releaseApproved = bool.fromEnvironment('ARENA_RELEASE_APPROVED');
}
