import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../lib/core/fiber_api.dart';

const _address =
    'http://198.51.100.25:3210'; // Reserved TEST-NET, never contacted.
http.Response _json(Object value, [int status = 200]) =>
    http.Response(jsonEncode(value), status);
http.Response _health() =>
    _json({'app': 'ISP Desk POS', 'version': '1.43.4', 'needsSetup': false});
http.Response _session() => _json({
  'data': {
    'sessionToken': 'synthetic_temporary_session_123456',
    'user': {
      'id': 1,
      'username': 'demo.staff',
      'fullName': 'Demo Staff',
      'role': 'cashier',
      'active': true,
      'accountKey': 'main:1',
      'permissions': ['dashboard.view'],
      'allowedSections': ['fiber-users'],
    },
  },
});

void main() {
  test(
    'temporary policy is exact origin, root-only, debug-only and opt-in',
    () {
      final configured = Uri.parse(_address);
      expect(FiberApiClient.temporaryHttpAllowed(configured, null), false);
      expect(FiberApiClient.temporaryHttpAllowed(configured, configured), true);
      expect(
        FiberApiClient.temporaryHttpAllowed(
          Uri.parse('$_address/'),
          configured,
        ),
        true,
      );
      expect(
        FiberApiClient.temporaryHttpAllowed(
          configured,
          configured,
          debugEnabled: false,
        ),
        false,
      );
      for (final candidate in [
        'http://198.51.100.26:3210',
        'http://198.51.100.25:3211',
        'http://198.51.100.25',
        'https://198.51.100.25:3210',
        'http://198.51.100.25:3210/rpc',
        'http://198.51.100.25:3210//',
        'http://198.51.100.25:3210/%2f',
        'http://198.51.100.25:3210?x=1',
        'http://198.51.100.25:3210#fragment',
        'http://user@198.51.100.25:3210',
        'http://198.051.100.25:3210',
        'http://198.51.100.25:0',
        'http://198.51.100.25:9999999999999999999999999999',
        'http://demo.invalid:3210',
        'http://[::1]:3210',
      ]) {
        expect(
          FiberApiClient.temporaryHttpAllowed(Uri.parse(candidate), configured),
          false,
          reason: candidate,
        );
        if (Uri.parse(candidate).scheme != 'https') {
          expect(
            () => FiberApiClient(
              server: Uri.parse(candidate),
              temporaryHttpEndpoint: configured,
            ),
            throwsA(isA<FiberApiException>()),
            reason: candidate,
          );
        }
      }
    },
  );

  test('disabled temporary capability cannot be turned on by providing an endpoint', () {
    final configured = Uri.parse(_address);
    expect(
      () => FiberApiClient(
        server: configured,
        temporaryHttpEndpoint: configured,
        temporaryHttpDebugEnabled: false,
      ),
      throwsA(isA<FiberApiException>()),
    );
    final secure = FiberApiClient(
      server: Uri.parse('https://demo.invalid'),
      temporaryHttpEndpoint: configured,
      temporaryHttpDebugEnabled: false,
    );
    expect(secure.usesTemporaryHttp, false);
    secure.dispose();
  });

  test('every temporary HTTP login needs fresh explicit consent', () async {
    var loginRequests = 0;
    final configured = Uri.parse(_address);
    final api = FiberApiClient(
      server: configured,
      temporaryHttpEndpoint: configured,
      transport: MockClient((request) async {
        expect(request.followRedirects, false);
        expect(request.url.authority, '198.51.100.25:3210');
        if (request.url.path == '/health') return _health();
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['channel'] == 'auth:login') {
          loginRequests++;
          return _session();
        }
        return _json({
          'data': {'ok': true},
        });
      }),
    );
    expect(api.usesTemporaryHttp, true);
    await api.connect();
    await expectLater(
      api.login('demo.staff', 'synthetic-only'),
      throwsA(
        isA<FiberApiException>().having(
          (error) => error.message,
          'message',
          contains('consent'),
        ),
      ),
    );
    expect(loginRequests, 0);
    await api.login('demo.staff', 'synthetic-only', allowTemporaryHttp: true);
    expect(loginRequests, 1);
    expect(api.session, isNotNull);
    await api.logout();
    await expectLater(
      api.login('demo.staff', 'synthetic-only'),
      throwsA(isA<FiberApiException>()),
    );
    expect(loginRequests, 1);
    api.dispose();
  });

  test(
    'temporary HTTP authentication cannot follow a redirect to another origin',
    () async {
      final requests = <Uri>[];
      final configured = Uri.parse(_address);
      final api = FiberApiClient(
        server: configured,
        temporaryHttpEndpoint: configured,
        transport: MockClient((request) async {
          requests.add(request.url);
          expect(request.followRedirects, false);
          if (request.url.path == '/health') return _health();
          return http.Response(
            '{}',
            307,
            headers: {'location': 'http://203.0.113.70:3210/rpc'},
          );
        }),
      );
      await api.connect();
      await expectLater(
        api.login('demo.staff', 'synthetic-only', allowTemporaryHttp: true),
        throwsA(isA<FiberApiException>()),
      );
      expect(requests.length, 2);
      expect(
        requests.every((uri) => uri.authority == configured.authority),
        true,
      );
      expect(api.session, isNull);
      api.dispose();
    },
  );
}
