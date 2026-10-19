import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/core/fiber_api.dart';

/// Real HTTP against a loopback-only synthetic Main PC. Never uses a public IP,
/// real login, customer database, Whish account or provider endpoint.
void main() {
  late Process process;
  late Uri endpoint;
  StreamSubscription<String>? output;
  StreamSubscription<List<int>>? errors;

  setUpAll(() async {
    process = await Process.start('node', ['tool/mock_server.cjs', '--port=0']);
    final ready = Completer<Uri>();
    output = process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) {
          final match = RegExp(r'http://127\.0\.0\.1:\d+').firstMatch(line);
          if (match != null && !ready.isCompleted) {
            ready.complete(Uri.parse(match.group(0)!));
          }
        });
    errors = process.stderr.listen((_) {});
    endpoint = await ready.future.timeout(const Duration(seconds: 15));
  });

  tearDownAll(() async {
    process.kill();
    await output?.cancel();
    await errors?.cancel();
    await process.exitCode.timeout(const Duration(seconds: 5));
  });

  for (final role in ['admin', 'cashier', 'support']) {
    test(
      'real synthetic HTTP: $role signs in, switches and reads exact DTOs',
      () async {
        final api = FiberApiClient(
          server: endpoint,
          allowInsecureLoopback: true,
        );
        try {
          expect((await api.connect()).version, '1.43.4');
          await api.login('demo.$role', 'demo-only-123');
          expect(api.session!.user.effectiveRole, role);
          if (role == 'admin') {
            final combined = await api.financeOverview(workspaceId: 'all');
            expect(combined.workspaceId, 'all');
            expect(combined.cash, isNotNull);
            expect(combined.revenue, isNull);
          }
          await api.switchWorkspace('fiber-users');
          final users = await api.financeOverview();
          expect(users.workspaceId, 'fiber-users');
          expect(users.cash, isNotNull);
          expect(users.walletTotal, isNotNull);
          final receipts = await api.bills(
            startDate: '2026-10-01',
            endDate: '2026-10-19',
          );
          expect(receipts, isNotEmpty);
          if (role == 'admin' || role == 'support') {
            final incomplete = receipts.where(
              (bill) => bill.renewalState == 'unknown',
            );
            expect(incomplete, isNotEmpty);
            expect(incomplete.first.paymentStatus, 'paid');
            expect(incomplete.first.renewalConfirmed, false);
          }
          final search = await api.searchCustomers('demo');
          expect(search.customers, isNotEmpty);
          expect(search.total, greaterThan(0));
          await api.switchWorkspace('fiber-resellers');
          final accounts = await api.resellerAccounts();
          expect(accounts.accounts, isNotEmpty);
          final representative = accounts.accounts.firstWhere(
            (row) => row.username == 'fibernetlb2',
          );
          expect(representative.balance, isNotNull);
          expect(representative.balance, lessThan(0));
          expect(await api.logout(), true);
          expect(api.session, isNull);
        } finally {
          api.dispose();
        }
      },
    );
  }
}
