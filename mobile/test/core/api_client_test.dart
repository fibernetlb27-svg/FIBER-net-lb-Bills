import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../lib/core/fiber_api.dart';

const _token = 'synthetic_token_1234567890123456';
const _nextToken = 'synthetic_token_9876543210987654';
Map<String, dynamic> _user({String role = 'admin'}) => {
  'id': 1,
  'username': 'demo.admin',
  'fullName': 'Demo Administrator',
  'role': role,
  'active': true,
  'accountKey': 'main:demo',
  'permissions': ['dashboard.view', 'reports.view', 'bills.view'],
  'allowedSections': ['main', 'fiber-users', 'fiber-resellers'],
};
http.Response _json(Object value, [int status = 200]) => http.Response(
  jsonEncode(value),
  status,
  headers: {'content-type': 'application/json'},
);
http.Response _health({String version = '1.43.4'}) =>
    _json({'app': 'ISP Desk POS', 'version': version, 'needsSetup': false});
http.Response _login({String token = _token}) => _json({
  'data': {'user': _user(), 'sessionToken': token},
});
Map<String, dynamic> _finance(String workspace) => {
  'workspaceId': workspace,
  'workspaceName': workspace,
  'admin': true,
  'wallets': <dynamic>[],
  'dashboard': {
    'drawer': {'balance': 100},
  },
  'report': {
    'revenue': 100,
    'grossProfit': 100,
    'netProfit': 100,
    'expenses': 0,
    'whishFees': 0,
  },
  'dashboardTotals': {
    'basis': workspace == 'all' ? 'business_sum' : 'independent_business',
    'cash': 100,
    'wallets': 0,
    'whishFees': 0,
    'otherExpenses': 0,
    'profitBeforeOther': 100,
    'profitAfterOther': 100,
    'profitKnown': true,
  },
};

FiberApiClient _client(
  FutureOr<http.Response> Function(http.Request) handler, {
  Duration? timeout,
}) => FiberApiClient(
  server: Uri.parse('https://demo.invalid/'),
  transport: MockClient((request) async => await handler(request)),
  readTimeout: timeout ?? const Duration(seconds: 2),
);

void main() {
  test('HTTPS required; insecure loopback needs explicit testing opt-in', () {
    for (final address in [
      'http://example.com',
      'http://192.168.1.2:3210',
      'http://127.0.0.1:33345',
      'https://name:secret@example.com',
      'https://example.com?token=secret',
      'https://example.com#secret',
    ]) {
      expect(
        () => FiberApiClient(server: Uri.parse(address)),
        throwsA(isA<FiberApiException>()),
      );
    }
    expect(
      () => FiberApiClient(
        server: Uri.parse('http://example.com'),
        allowInsecureLoopback: true,
      ),
      throwsA(isA<FiberApiException>()),
    );
    final loopback = FiberApiClient(
      server: Uri.parse('http://127.0.0.1:33345'),
      allowInsecureLoopback: true,
    );
    expect(loopback.server.toString(), 'http://127.0.0.1:33345/');
    loopback.dispose();
  });

  test(
    'unknown server version is rejected rather than echoed as trusted',
    () async {
      final api = _client((_) => _health(version: '1.99.0'));
      await expectLater(
        api.connect(),
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.compatibility,
          ),
        ),
      );
      expect(api.isConnected, false);
      await expectLater(
        api.login('demo', 'password'),
        throwsA(isA<FiberApiException>()),
      );
      api.dispose();
    },
  );

  test(
    'actual RPC contract, token binding, version, and no redirects',
    () async {
      final requests = <http.Request>[];
      final api = _client((request) {
        requests.add(request);
        expect(request.followRedirects, false);
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(request.headers['X-Client-Version'], '1.43.4');
        expect(body['workspaceId'], 'main');
        if (body['channel'] == 'auth:login') {
          expect(body['args'], [
            {'username': 'demo.admin', 'password': 'password'},
          ]);
          expect(request.headers['Authorization'], isNull);
          return _login();
        }
        expect(request.headers['Authorization'], 'Bearer $_token');
        if (body['channel'] == 'finance:overview') {
          expect(body['args'], [
            {'workspaceId': 'all'},
          ]);
          return _json({'data': _finance('all')});
        }
        return _json({
          'data': {'ok': true},
        });
      });
      await api.connect();
      final session = await api.login(' demo.admin ', 'password');
      expect(session.user.fullName, 'Demo Administrator');
      expect((await api.financeOverview(workspaceId: 'all')).cash, 100);
      expect(await api.logout(), true);
      expect(api.session, isNull);
      expect(requests.length, 4);
      api.dispose();
    },
  );

  test(
    'business switch rotates token and revokes original workspace token',
    () async {
      final seen = <Map<String, dynamic>>[];
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        seen.add({...body, 'authorization': request.headers['Authorization']});
        if (body['channel'] == 'auth:login') return _login();
        if (body['channel'] == 'auth:switch') return _login(token: _nextToken);
        if (body['channel'] == 'finance:overview')
          return _json({'data': _finance('fiber-users')});
        return _json({
          'data': {'ok': true},
        });
      });
      await api.connect();
      await api.login('demo', 'password');
      await api.switchWorkspace('fiber-users');
      expect(api.session!.workspaceId, 'fiber-users');
      expect(seen[1]['channel'], 'auth:switch');
      expect(seen[1]['args'], ['fiber-users']);
      expect(seen[1]['workspaceId'], 'main');
      expect(seen[2]['channel'], 'auth:logout');
      expect(seen[2]['authorization'], 'Bearer $_token');
      expect(seen[2]['workspaceId'], 'main');
      await api.financeOverview();
      expect(seen.last['authorization'], 'Bearer $_nextToken');
      expect(seen.last['workspaceId'], 'fiber-users');
      api.dispose();
    },
  );

  test(
    'expired session clears credentials even if proxy body is HTML',
    () async {
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body);
        return body['channel'] == 'auth:login'
            ? _login()
            : http.Response('<html>Unauthorized</html>', 401);
      });
      await api.connect();
      await api.login('demo', 'password');
      await expectLater(
        api.financeOverview(),
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.authentication,
          ),
        ),
      );
      expect(api.session, isNull);
      api.dispose();
    },
  );

  test(
    'reads cannot start against the old workspace during a switch',
    () async {
      final switching = Completer<http.Response>();
      var reads = 0;
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body);
        if (body['channel'] == 'auth:login') return _login();
        if (body['channel'] == 'auth:switch') return switching.future;
        if (body['channel'] == 'finance:overview') reads++;
        return _json({
          'data': {'ok': true},
        });
      });
      await api.connect();
      await api.login('demo', 'password');
      final pending = api.switchWorkspace('fiber-users');
      await expectLater(
        api.financeOverview(),
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.sessionChanged,
          ),
        ),
      );
      expect(reads, 0);
      switching.complete(_login(token: _nextToken));
      await pending;
      expect(api.session!.workspaceId, 'fiber-users');
      api.dispose();
    },
  );

  test(
    '409 invalidates both session and compatibility proof without JSON',
    () async {
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body);
        return body['channel'] == 'auth:login'
            ? _login()
            : http.Response('', 409);
      });
      await api.connect();
      await api.login('demo', 'password');
      await expectLater(
        api.financeOverview(),
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.compatibility,
          ),
        ),
      );
      expect(api.session, isNull);
      expect(api.isConnected, false);
      api.dispose();
    },
  );

  test('read result cannot leak into screen after sign-out', () async {
    final delayed = Completer<http.Response>();
    final api = _client((request) {
      if (request.url.path == '/health') return _health();
      final body = jsonDecode(request.body);
      if (body['channel'] == 'auth:login') return _login();
      if (body['channel'] == 'finance:overview') return delayed.future;
      return _json({
        'data': {'ok': true},
      });
    });
    await api.connect();
    await api.login('demo', 'password');
    final pending = api.financeOverview();
    final assertion = expectLater(
      pending,
      throwsA(
        isA<FiberApiException>().having(
          (error) => error.kind,
          'kind',
          ApiFailure.sessionChanged,
        ),
      ),
    );
    await api.logout();
    delayed.complete(_json({'data': _finance('main')}));
    await assertion;
    expect(api.session, isNull);
    api.dispose();
  });

  test('stale 401 does not revoke the next signed-in account', () async {
    final delayed = Completer<http.Response>();
    final api = _client((request) {
      if (request.url.path == '/health') return _health();
      final body = jsonDecode(request.body);
      if (body['channel'] == 'auth:login') return _login();
      if (body['channel'] == 'finance:overview') return delayed.future;
      return _json({
        'data': {'ok': true},
      });
    });
    await api.connect();
    await api.login('demo', 'password');
    final pending = api.financeOverview();
    final assertion = expectLater(pending, throwsA(isA<FiberApiException>()));
    await api.logout();
    await api.login('demo', 'password');
    delayed.complete(http.Response('', 401));
    await assertion;
    expect(api.session, isNotNull);
    api.dispose();
  });

  test(
    'late login is discarded and its newly-created remote token revoked',
    () async {
      final delayed = Completer<http.Response>();
      final calls = <String>[];
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body);
        calls.add(body['channel'] as String);
        if (body['channel'] == 'auth:login') return delayed.future;
        return _json({
          'data': {'ok': true},
        });
      });
      await api.connect();
      final pending = api.login('demo', 'password');
      final assertion = expectLater(
        pending,
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.sessionChanged,
          ),
        ),
      );
      await api.logout();
      delayed.complete(_login());
      await assertion;
      expect(calls, ['auth:login', 'auth:logout']);
      expect(api.session, isNull);
      api.dispose();
    },
  );

  test('timeout is explicit and no retries are attempted', () async {
    var reads = 0;
    final api = _client((_) {
      reads++;
      return Completer<http.Response>().future;
    }, timeout: const Duration(milliseconds: 10));
    await expectLater(
      api.connect(),
      throwsA(
        isA<FiberApiException>().having(
          (error) => error.kind,
          'kind',
          ApiFailure.timeout,
        ),
      ),
    );
    expect(reads, 1);
    expect(api.isConnected, false);
    api.dispose();
  });

  test(
    'a late token issued after login timeout is revoked, never accepted',
    () async {
      final delayed = Completer<http.Response>();
      final revoked = Completer<void>();
      final api = _client((request) {
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body);
        if (body['channel'] == 'auth:login') return delayed.future;
        if (body['channel'] == 'auth:logout') {
          expect(request.headers['Authorization'], 'Bearer $_token');
          revoked.complete();
        }
        return _json({
          'data': {'ok': true},
        });
      }, timeout: const Duration(milliseconds: 10));
      await api.connect();
      await expectLater(
        api.login('demo', 'password'),
        throwsA(
          isA<FiberApiException>().having(
            (error) => error.kind,
            'kind',
            ApiFailure.timeout,
          ),
        ),
      );
      expect(api.session, isNull);
      delayed.complete(_login());
      await revoked.future.timeout(const Duration(seconds: 2));
      expect(api.session, isNull);
      api.dispose();
    },
  );

  test('malformed money response never becomes a zero balance', () async {
    final api = _client((request) {
      if (request.url.path == '/health') return _health();
      final body = jsonDecode(request.body);
      if (body['channel'] == 'auth:login') return _login();
      return _json({
        'data': {'workspaceId': 'main'},
      });
    });
    await api.connect();
    await api.login('demo', 'password');
    await expectLater(
      api.financeOverview(),
      throwsA(
        isA<FiberApiException>().having(
          (error) => error.kind,
          'kind',
          ApiFailure.malformedResponse,
        ),
      ),
    );
    api.dispose();
  });

  test(
    'bill range validation rejects calendar-normalized invalid dates',
    () async {
      final api = _client((_) => _health());
      await expectLater(
        api.bills(startDate: '2026-02-30', endDate: '2026-03-01'),
        throwsA(isA<FiberApiException>()),
      );
      await expectLater(
        api.bills(startDate: '2026-10-19', endDate: '2026-10-18'),
        throwsA(isA<FiberApiException>()),
      );
      api.dispose();
    },
  );

  test('dispose prevents future transport use and forgets session', () async {
    final api = _client(
      (request) => request.url.path == '/health' ? _health() : _login(),
    );
    await api.connect();
    await api.login('demo', 'password');
    api.dispose();
    expect(api.session, isNull);
    expect(api.isConnected, false);
    await expectLater(api.financeOverview(), throwsA(isA<FiberApiException>()));
  });
}
