import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'models.dart';

/// Explicit, read-oriented mobile adapter for the existing Main PC service.
/// No public generic RPC or payment/renewal/write method is provided.
class FiberApiClient {
  FiberApiClient({
    required Uri server,
    http.Client? transport,
    bool allowInsecureLoopback = false,
    Uri? temporaryHttpEndpoint,
    bool temporaryHttpDebugEnabled = true,
    this.readTimeout = const Duration(seconds: 20),
    this.portalTimeout = const Duration(seconds: 65),
  }) : server = _validatedServer(
         server,
         allowInsecureLoopback,
         temporaryHttpEndpoint,
         temporaryHttpDebugEnabled,
       ),
       usesTemporaryHttp = temporaryHttpAllowed(
         server,
         temporaryHttpEndpoint,
         debugEnabled: temporaryHttpDebugEnabled,
       ),
       _transport = transport ?? http.Client();

  /// A known, tested contract, not the mobile app's marketing version.
  static const supportedServerVersions = {'1.43.4'};
  static const _maxResponseBytes = 8 * 1024 * 1024;
  final Uri server;

  /// True only for the privately configured, exact-origin debug exception.
  final bool usesTemporaryHttp;
  final http.Client _transport;
  final Duration readTimeout;
  final Duration portalTimeout;
  ServerInfo? _serverInfo;
  AppSession? _session;
  String? _token;
  int _generation = 0;
  bool _disposed = false;
  bool _authBusy = false;

  ServerInfo? get serverInfo => _serverInfo;
  AppSession? get session => _session;
  bool get isConnected => !_disposed && _serverInfo != null;

  /// No DNS names, implicit ports, userinfo, encoded/extra paths, queries or
  /// fragments. This is an exact IPv4 origin, not a general HTTP opt-out.
  static String? _canonicalTemporaryOrigin(Uri value) {
    if (value.scheme != 'http' ||
        !value.hasPort ||
        value.userInfo.isNotEmpty ||
        value.authority.contains('@') ||
        value.hasQuery ||
        value.hasFragment ||
        !(value.path.isEmpty || value.path == '/'))
      return null;
    // Do not read Uri.port before validating: very long numeric ports can
    // survive Uri.parse and throw when its deferred port getter is accessed.
    final authority = value.authority;
    final portText = authority.substring(authority.lastIndexOf(':') + 1);
    final port = int.tryParse(portText);
    if (port == null || port < 1 || port > 65535 || port.toString() != portText)
      return null;
    final octets = value.host.split('.');
    if (octets.length != 4 ||
        octets.any((part) {
          final number = int.tryParse(part);
          return number == null ||
              number < 0 ||
              number > 255 ||
              number.toString() != part;
        }))
      return null;
    if (value.authority != '${value.host}:$port') return null;
    return 'http://${value.host}:$port';
  }

  static bool temporaryHttpAllowed(
    Uri candidate,
    Uri? configured, {
    bool debugEnabled = true,
  }) {
    // A caller cannot turn this on in profile/release by passing true.
    if (!kDebugMode || !debugEnabled || configured == null) return false;
    final allowed = _canonicalTemporaryOrigin(configured);
    return allowed != null && _canonicalTemporaryOrigin(candidate) == allowed;
  }

  static Uri _validatedServer(
    Uri server,
    bool allowLoopback,
    Uri? temporaryHttpEndpoint,
    bool temporaryHttpDebugEnabled,
  ) {
    // Uri normalizes some spellings (such as empty userinfo or zero-padded
    // ports). The controller additionally checks the original address text.
    final host = server.host.toLowerCase();
    final loopback =
        host == '127.0.0.1' || host == 'localhost' || host == '::1';
    if (!server.hasAuthority ||
        host.isEmpty ||
        server.userInfo.isNotEmpty ||
        server.authority.contains('@') ||
        server.hasQuery ||
        server.hasFragment ||
        !(server.scheme == 'https' ||
            server.scheme == 'http' &&
                allowLoopback &&
                loopback &&
                kDebugMode ||
            temporaryHttpAllowed(
              server,
              temporaryHttpEndpoint,
              debugEnabled: temporaryHttpDebugEnabled,
            ))) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Use the secure HTTPS address supplied by your administrator. '
        'Passwords must not be included in the address.',
      );
    }
    return server.replace(
      path: '${server.path.replaceAll(RegExp(r'/+$'), '')}/',
    );
  }

  void _checkOpen() {
    if (_disposed) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'This connection is closed. Open a new connection to sign in.',
      );
    }
  }

  void _checkGeneration(int generation) {
    _checkOpen();
    if (generation != _generation) {
      throw const FiberApiException(
        ApiFailure.sessionChanged,
        'The signed-in account or business changed. Refresh this screen.',
      );
    }
  }

  Future<ServerInfo> connect() async {
    _checkOpen();
    if (_authBusy || _session != null) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Sign out before checking a different connection.',
      );
    }
    final generation = ++_generation;
    _serverInfo = null;
    final json = await _send('GET', 'health', timeout: readTimeout);
    _checkGeneration(generation);
    final version = jsonText(json['version']);
    if (json['app'] != 'ISP Desk POS' ||
        !supportedServerVersions.contains(version) ||
        json['needsSetup'] is! bool) {
      throw const FiberApiException(
        ApiFailure.compatibility,
        'This server is not a supported FIBER net lb Bills version. '
        'This mobile build supports Main PC version 1.43.4 only. '
        'Ask your administrator to match the app and Main PC versions.',
      );
    }
    final info = ServerInfo(
      version: version,
      needsSetup: json['needsSetup'] == true,
    );
    _serverInfo = info;
    return info;
  }

  Future<AppSession> login(
    String username,
    String password, {
    String workspaceId = 'main',
    bool allowTemporaryHttp = false,
  }) async {
    _checkOpen();
    _requireConnected();
    if (usesTemporaryHttp && !allowTemporaryHttp) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Temporary HTTP testing requires your explicit consent for this login. '
        'Your password and account data would travel without encryption.',
      );
    }
    if (_authBusy || _session != null) {
      throw const FiberApiException(
        ApiFailure.authentication,
        'Finish signing in or sign out before changing accounts.',
      );
    }
    if (Workspace.find(workspaceId) == null ||
        username.trim().isEmpty ||
        password.isEmpty) {
      throw const FiberApiException(
        ApiFailure.authentication,
        'Enter your username and password and choose a valid business.',
      );
    }
    if (_serverInfo!.needsSetup) {
      throw const FiberApiException(
        ApiFailure.authentication,
        'Set up the administrator account on the Main PC first.',
      );
    }
    _authBusy = true;
    final generation = ++_generation;
    try {
      final data = await _call(
        'auth:login',
        [
          {'username': username.trim(), 'password': password},
        ],
        workspaceId: workspaceId,
        authenticated: false,
      );
      _checkGeneration(generation);
      return _acceptSession(data, workspaceId);
    } finally {
      _authBusy = false;
    }
  }

  Future<AppSession> switchWorkspace(String workspaceId) async {
    final current = _requireSession();
    if (_authBusy) {
      throw const FiberApiException(
        ApiFailure.sessionChanged,
        'Wait for the current sign-in or business change to finish.',
      );
    }
    if (!current.user.allowedWorkspaces.any((item) => item.id == workspaceId)) {
      throw const FiberApiException(
        ApiFailure.permission,
        'Your administrator has not granted access to this business.',
      );
    }
    if (current.workspaceId == workspaceId) return current;
    _authBusy = true;
    final oldToken = _token!;
    final oldWorkspace = current.workspaceId;
    final generation = ++_generation;
    try {
      final data = await _call('auth:switch', [
        workspaceId,
      ], workspaceId: oldWorkspace);
      _checkGeneration(generation);
      final next = _acceptSession(data, workspaceId);
      // Desktop leaves the origin token active. Revoke it after a successful
      // mobile switch. A temporary failure never restores an old account view.
      await _revoke(oldToken, oldWorkspace);
      _checkGeneration(generation);
      return next;
    } finally {
      _authBusy = false;
    }
  }

  Future<AppUser?> refreshSession() async {
    final current = _requireSession();
    final data = jsonObject(
      await _call('auth:status', [], workspaceId: current.workspaceId),
    );
    if (data['user'] == null) {
      clearSession();
      return null;
    }
    final user = AppUser.fromJson(jsonObject(data['user']));
    _validateUser(user);
    _session = AppSession(user: user, workspaceId: current.workspaceId);
    return user;
  }

  /// Clears in-memory credentials immediately, then attempts remote revocation.
  /// False means the phone is signed out but Main could not be reached to revoke.
  Future<bool> logout() async {
    _checkOpen();
    final token = _token;
    final workspace = _session?.workspaceId;
    clearSession();
    if (token == null || workspace == null) return true;
    return _revoke(token, workspace);
  }

  void clearSession() {
    _generation++;
    _token = null;
    _session = null;
  }

  Future<FinanceOverview> financeOverview({
    String? workspaceId,
    String? accountKey,
  }) async {
    final current = _requireSession();
    final target = workspaceId ?? current.workspaceId;
    if (target != current.workspaceId &&
        !(current.workspaceId == 'main' && current.user.isAdmin)) {
      throw const FiberApiException(
        ApiFailure.permission,
        'Open the business before viewing its finances.',
      );
    }
    if (target != 'all' && Workspace.find(target) == null) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Choose a valid business.',
      );
    }
    final input = <String, dynamic>{
      'workspaceId': target,
      if (accountKey != null) 'accountKey': accountKey,
    };
    final data = await _call('finance:overview', [input]);
    final json = _requireMap(data);
    if (json['workspaceId'] != target ||
        json['dashboard'] is! Map ||
        json['report'] is! Map ||
        json['wallets'] is! List) {
      throw _invalidResponse();
    }
    return FinanceOverview.fromJson(json);
  }

  Future<JsonMap> reportsDashboard() async =>
      _requireMap(await _call('reports:dashboard', []));

  Future<ResellerAccounts> resellerAccounts() async {
    _requireWorkspace('fiber-resellers');
    final json = _requireMap(
      await _call('resellers:accounts', [], timeout: portalTimeout),
    );
    if (json['accounts'] is! List) throw _invalidResponse();
    return ResellerAccounts.fromJson(json);
  }

  Future<List<BillReceipt>> bills({
    required String startDate,
    required String endDate,
  }) async {
    if (!_isDate(startDate) ||
        !_isDate(endDate) ||
        startDate.compareTo(endDate) > 0) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Choose valid start and end dates.',
      );
    }
    final data = await _call('bills:list', [startDate, endDate]);
    if (data is! List || data.any((row) => row is! Map)) {
      throw _invalidResponse();
    }
    return List.unmodifiable(
      data.map((row) => BillReceipt.fromJson(jsonObject(row))),
    );
  }

  Future<CustomerSearch> searchCustomers(String term) async {
    _requireWorkspace('fiber-users');
    final query = term.trim();
    if (query.length < 3 || query.length > 128) {
      throw const FiberApiException(
        ApiFailure.configuration,
        'Enter 3 to 128 characters of a customer name, username or phone.',
      );
    }
    final json = _requireMap(
      await _call('portal:search', [query], timeout: portalTimeout),
    );
    if (json['customers'] is! List || json['total'] is! int) {
      throw _invalidResponse();
    }
    return CustomerSearch.fromJson(json);
  }

  AppSession _acceptSession(dynamic value, String workspaceId) {
    final data = _requireMap(value);
    final token = jsonText(data['sessionToken']);
    final user = AppUser.fromJson(jsonObject(data['user']));
    _validateUser(user);
    // Do not persist or display the bearer token. Reject malformed headers.
    if (!RegExp(r'^[a-zA-Z0-9._~+/-]{16,512}={0,2}$').hasMatch(token)) {
      throw _invalidResponse();
    }
    _token = token;
    return _session = AppSession(user: user, workspaceId: workspaceId);
  }

  void _validateUser(AppUser user) {
    if (!user.active ||
        user.id < 1 ||
        user.username.isEmpty ||
        user.accountKey.isEmpty ||
        user.role.isEmpty) {
      throw _invalidResponse();
    }
  }

  void _requireConnected() {
    _checkOpen();
    if (_serverInfo == null) {
      throw const FiberApiException(
        ApiFailure.compatibility,
        'Verify the server connection before signing in.',
      );
    }
  }

  AppSession _requireSession() {
    _requireConnected();
    final current = _session;
    if (current == null || _token == null) {
      throw const FiberApiException(
        ApiFailure.authentication,
        'Sign in to your staff account first.',
      );
    }
    return current;
  }

  void _requireWorkspace(String workspaceId) {
    if (_requireSession().workspaceId != workspaceId) {
      throw const FiberApiException(
        ApiFailure.permission,
        'Open the correct business before using this section.',
      );
    }
  }

  Future<dynamic> _call(
    String channel,
    List<dynamic> args, {
    String? workspaceId,
    bool authenticated = true,
    Duration? timeout,
  }) async {
    _requireConnected();
    if (authenticated && _authBusy && channel != 'auth:switch') {
      throw const FiberApiException(
        ApiFailure.sessionChanged,
        'Wait for the business change to finish, then refresh this screen.',
      );
    }
    final current = authenticated ? _requireSession() : null;
    final generation = _generation;
    final response = await _send(
      'POST',
      'rpc',
      body: {
        'channel': channel,
        'args': args,
        'workspaceId': workspaceId ?? current?.workspaceId ?? 'main',
      },
      token: authenticated ? _token : null,
      timeout: timeout ?? readTimeout,
    );
    if (generation != _generation || _disposed) {
      // A late login/switch can create a server token after the user signs out.
      // Revoke that result as well; never install it into the new session.
      if (channel == 'auth:login' || channel == 'auth:switch') {
        final late = jsonObject(response['data']);
        final lateToken = jsonText(late['sessionToken']);
        if (lateToken.isNotEmpty && !_disposed) {
          await _revoke(
            lateToken,
            channel == 'auth:switch'
                ? jsonText(args.first)
                : workspaceId ?? 'main',
          );
        }
      }
      _checkGeneration(generation);
    }
    _checkGeneration(generation);
    if (!response.containsKey('data')) throw _invalidResponse();
    return response['data'];
  }

  Future<bool> _revoke(String token, String workspaceId) async {
    try {
      await _send(
        'POST',
        'rpc',
        body: {
          'channel': 'auth:logout',
          'args': <dynamic>[],
          'workspaceId': workspaceId,
        },
        token: token,
        timeout: const Duration(seconds: 5),
        invalidateOnUnauthorized: false,
      );
      return true;
    } on FiberApiException {
      return false;
    }
  }

  Future<JsonMap> _send(
    String method,
    String route, {
    JsonMap? body,
    String? token,
    required Duration timeout,
    bool invalidateOnUnauthorized = true,
  }) async {
    _checkOpen();
    final generation = _generation;
    Future<JsonMap> perform() async {
      final request = http.Request(method, server.resolve(route));
      // Never follow a redirect carrying an Authorization header or password.
      request.followRedirects = false;
      request.headers['Accept'] = 'application/json';
      if (_serverInfo != null) {
        request.headers['X-Client-Version'] = _serverInfo!.version;
      }
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      final response = await _transport.send(request);
      // Authentication/version status is authoritative even if a reverse proxy
      // supplies an HTML or empty body. A stale request cannot clear a new user.
      if (response.statusCode == 401 || response.statusCode == 409) {
        if (generation == _generation &&
            (response.statusCode == 409 || invalidateOnUnauthorized)) {
          clearSession();
          if (response.statusCode == 409) _serverInfo = null;
        }
        await response.stream.drain<void>();
        throw FiberApiException(
          response.statusCode == 401
              ? ApiFailure.authentication
              : ApiFailure.compatibility,
          response.statusCode == 401
              ? 'Your session ended. Please sign in again.'
              : 'The Main PC version changed. Sign in using a matching mobile update.',
          statusCode: response.statusCode,
        );
      }
      final bytes = <int>[];
      await for (final chunk in response.stream) {
        if (bytes.length + chunk.length > _maxResponseBytes) {
          throw _invalidResponse();
        }
        bytes.addAll(chunk);
      }
      dynamic decoded;
      try {
        decoded = jsonDecode(utf8.decode(bytes));
      } on FormatException {
        throw _invalidResponse();
      }
      if (decoded is! Map<String, dynamic>) throw _invalidResponse();
      final status = response.statusCode;
      final error = jsonText(decoded['error']);
      if (status < 200 || status >= 300 || error.isNotEmpty) {
        final expired =
            status == 401 ||
            error == 'Your session ended. Please sign in again.';
        if (expired && invalidateOnUnauthorized && generation == _generation) {
          clearSession();
        }
        if (status == 409 && generation == _generation) {
          clearSession();
          _serverInfo = null;
        }
        throw FiberApiException(
          expired
              ? ApiFailure.authentication
              : status == 409
              ? ApiFailure.compatibility
              : status == 403
              ? ApiFailure.permission
              : ApiFailure.rejected,
          expired
              ? 'Your session ended. Please sign in again.'
              : status == 409
              ? 'The Main PC version changed. Sign in using a matching mobile update.'
              : status == 403
              ? 'Your account cannot access this section. Ask your administrator.'
              : body?['channel'] == 'auth:login'
              ? 'Sign-in was not accepted. Check your username, password and account access.'
              : 'The Main PC could not complete this request. Try refreshing, '
                    'or ask your administrator to check the server.',
          statusCode: status,
        );
      }
      return decoded;
    }

    final operation = perform();
    try {
      return await operation.timeout(timeout);
    } on FiberApiException {
      rethrow;
    } on TimeoutException {
      if (body?['channel'] == 'auth:login' ||
          body?['channel'] == 'auth:switch') {
        // HTTP cancellation cannot guarantee that Main did not issue a token.
        // If its delayed reply does arrive, revoke that unaccepted token.
        unawaited(_revokeTimedOutSession(operation, body!));
      }
      throw const FiberApiException(
        ApiFailure.timeout,
        'The Main PC is taking too long to respond. Check the connection and try again.',
      );
    } catch (_) {
      throw const FiberApiException(
        ApiFailure.connection,
        'Could not connect securely to the Main PC. Check its HTTPS address, '
        'Internet connection and that the desktop app is running.',
      );
    }
  }

  Future<void> _revokeTimedOutSession(
    Future<JsonMap> operation,
    JsonMap body,
  ) async {
    try {
      final late = jsonObject((await operation)['data']);
      final token = jsonText(late['sessionToken']);
      if (_disposed || token.isEmpty) return;
      final workspace = body['channel'] == 'auth:switch'
          ? jsonText(jsonList(body['args']).firstOrNull)
          : jsonText(body['workspaceId']);
      if (Workspace.find(workspace) != null) await _revoke(token, workspace);
    } catch (_) {
      // A lost reply contains no token that this device could revoke. Main's
      // existing session expiry still applies; it is never accepted locally.
    }
  }

  JsonMap _requireMap(dynamic value) {
    if (value is! Map<String, dynamic>) throw _invalidResponse();
    return value;
  }

  FiberApiException _invalidResponse() => const FiberApiException(
    ApiFailure.malformedResponse,
    'The Main PC returned an unexpected response. No unverified balance was shown.',
  );

  bool _isDate(String value) {
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return false;
    final date = DateTime.tryParse(value);
    return date != null && date.toIso8601String().startsWith(value);
  }

  /// No credentials or financial records are saved to disk by this client.
  void dispose() {
    if (_disposed) return;
    clearSession();
    _serverInfo = null;
    _disposed = true;
    _transport.close();
  }
}
