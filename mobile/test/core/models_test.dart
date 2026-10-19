import 'package:flutter_test/flutter_test.dart';

import '../../lib/core/models.dart';

void main() {
  group('USD contract', () {
    test('only finite numeric exact cents are accepted', () {
      expect(usdAmount(0), 0);
      expect(usdAmount(200), 200);
      expect(usdAmount(-240.00), -240.00);
      expect(usdAmount(12.5), 12.5);
      for (final invalid in [
        null,
        '',
        '100',
        double.nan,
        double.infinity,
        true,
        1.001,
        1e20,
      ]) {
        expect(usdAmount(invalid), isNull);
      }
    });
  });

  test('section-origin user gets correct role and only granted workspaces', () {
    final user = AppUser.fromJson({
      'id': 2,
      'username': 'demo',
      'fullName': 'Demo Cashier',
      'role': 'section_user',
      'sourceRole': 'cashier',
      'active': true,
      'accountKey': 'fiber-users:demo',
      'permissions': ['dashboard.view'],
      'allowedSections': ['fiber-users', 'fiber-resellers', 'main-expenses'],
    });
    expect(user.effectiveRole, 'cashier');
    expect(user.isAdmin, false);
    expect(user.allowedWorkspaces.map((item) => item.id), [
      'main',
      'fiber-users',
      'fiber-resellers',
    ]);
    expect(user.can('dashboard.view'), true);
    expect(user.can('users.manage'), false);
  });

  test('Admin profits are server totals, not mobile recomputation', () {
    final view = FinanceOverview.fromJson({
      'workspaceId': 'fiber-resellers',
      'admin': true,
      'wallets': [
        {'id': 'w1', 'label': 'Company', 'balance': 200},
      ],
      'dashboard': {
        'drawer': {'balance': 100},
      },
      'report': {'revenue': 999, 'netProfit': 999},
      'bandwidthCost': {'incurredCost': 500},
      'dashboardTotals': {
        'basis': 'independent_business',
        'cash': 100,
        'wallets': 200,
        'whishFees': 2,
        'otherExpenses': 10,
        'profitBeforeOther': -2,
        'profitAfterOther': -12,
        'profitKnown': true,
      },
    });
    expect(view.revenue, 300);
    expect(view.walletTotal, 200);
    expect(view.whishFees, 2);
    expect(view.bandwidthCost, 500);
    expect(view.netProfit(), -2);
    expect(view.netProfit(deductOtherExpenses: true), -12);
  });

  test('unavailable Admin totals never become zero or a guessed profit', () {
    final view = FinanceOverview.fromJson({
      'workspaceId': 'fiber-resellers',
      'admin': true,
      'wallets': [
        {'id': 'w1', 'balance': null},
      ],
      'dashboard': {
        'drawer': {'balance': null},
      },
      'report': {'grossProfit': 1000, 'netProfit': 900},
    });
    expect(view.cash, isNull);
    expect(view.walletTotal, isNull);
    expect(view.revenue, isNull);
    expect(view.profitKnown, false);
    expect(view.netProfit(), isNull);
  });

  test('All businesses hides revenue and Internet cost', () {
    final view = FinanceOverview.fromJson({
      'workspaceId': 'all',
      'admin': true,
      'internetCost': 1600,
      'wallets': <dynamic>[],
      'dashboard': <String, dynamic>{},
      'report': {'revenue': 2500},
      'dashboardTotals': {
        'basis': 'business_sum',
        'cash': 7000,
        'wallets': 500,
        'whishFees': 5,
        'otherExpenses': 0,
        'profitBeforeOther': 1234,
        'profitAfterOther': 1234,
        'profitKnown': true,
      },
    });
    expect(view.aggregate, true);
    expect(view.revenue, isNull);
    expect(view.internetCost, isNull);
    expect(view.cash, 7000);
    expect(view.netProfit(), 1234);
  });

  test(
    'staff profit choice follows existing report without wallet fee debit',
    () {
      final view = FinanceOverview.fromJson({
        'workspaceId': 'fiber-users',
        'admin': false,
        'wallets': [
          {'id': 'w1', 'balance': 1250},
        ],
        'dashboard': {
          'drawer': {'balance': 300},
        },
        'internetCost': 1600,
        'report': {
          'revenue': 2500,
          'grossProfit': 900,
          'expenses': 22.5,
          'whishFees': 12.5,
          'netProfit': 877.5,
        },
      });
      expect(view.walletTotal, 1250);
      expect(view.internetCost, 1600);
      expect(view.otherExpenses, 10);
      expect(view.netProfit(), 887.5);
      expect(view.netProfit(deductOtherExpenses: true), 877.5);
    },
  );

  test('unverified Proradius balance is not displayed as zero', () {
    final available = ResellerAccount.fromJson({
      'username': 'fibernetlb2',
      'balance': -240.00,
      'balanceRead': true,
      'balanceAvailable': true,
      'moneyAdded': 200,
      'moneyCollected': 100,
      'pendingToCollect': 100,
    });
    expect(available.balance, -240.00);
    expect(available.toCollect, 100);
    for (final row in [
      {'balance': 0, 'balanceRead': false, 'balanceAvailable': true},
      {'balance': 0, 'balanceRead': true, 'balanceAvailable': false},
      {'balance': '0', 'balanceRead': true, 'balanceAvailable': true},
    ]) {
      expect(ResellerAccount.fromJson(row).balance, isNull);
    }
  });

  test('receipts and customer results use real DTO names', () {
    final receipt = BillReceipt.fromJson({
      'id': 1,
      'receiptNo': 'DEMO-001',
      'customerAccount': 'demo.customer',
      'customerName': 'Demo Customer',
      'bundleName': 'Internet',
      'amount': 30,
      'paymentMethod': 'Whish Money',
      'paidAt': '2026-10-19T12:00:00',
      'cashierName': 'Demo Cashier',
    });
    expect(receipt.amount, 30);
    expect(receipt.customerAccount, 'demo.customer');
    final search = CustomerSearch.fromJson({
      'customers': [
        {'username': 'demo.customer', 'name': 'Demo Customer', 'blocked': 1},
      ],
      'total': 1,
    });
    expect(search.customers.single.blocked, true);
    expect(search.total, 1);
  });

  test('a paid bill with an unknown renewal is never a successful renewal', () {
    final receipt = BillReceipt.fromJson({
      'id': 2,
      'receiptNo': 'DEMO-002',
      'amount': 40,
      'paymentStatus': 'paid',
      'renewal': {
        'state': 'unknown',
        'message': 'Review the saved provider operation.',
        'requestedMonths': 2,
        'completedMonths': 1,
      },
    });
    expect(receipt.paymentStatus, 'paid');
    expect(receipt.renewalState, 'unknown');
    expect(receipt.renewalConfirmed, false);
    expect(receipt.completedMonths, 1);
    expect(receipt.requestedMonths, 2);
  });
}
