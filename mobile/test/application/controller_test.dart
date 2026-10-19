import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../../lib/application/controller.dart';
import '../../lib/core/fiber_api.dart' as core;
import '../../lib/ui/models.dart' as ui;

const _input = ui.SignInInput(
  endpoint: 'https://demo.invalid',
  username: 'demo.staff',
  password: 'demo-only',
);

class _FakeApi extends core.FiberApiClient {
  _FakeApi({
    this.role = 'admin',
    this.sectionOrigin = false,
    Uri? server,
    Uri? temporaryHttpEndpoint,
    bool temporaryHttpDebugEnabled = true,
  }) : super(
         server: server ?? Uri.parse('https://demo.invalid'),
         temporaryHttpEndpoint: temporaryHttpEndpoint,
         temporaryHttpDebugEnabled: temporaryHttpDebugEnabled,
         transport: MockClient((_) async => http.Response('', 500)),
       );

  String role;
  bool sectionOrigin;
  bool expired = false;
  bool networkDown = false;
  bool financeDenied = false;
  bool billsDenied = false;
  bool resellersDenied = false;
  Object? loginFailure;
  int logoutCalls = 0;
  int refreshCalls = 0;
  int searchCalls = 0;
  int disposeCalls = 0;
  int connectCalls = 0;
  int loginCalls = 0;
  bool lastTemporaryConsent = false;
  String? billStart;
  String? billEnd;
  List<String> sections = ['fiber-users', 'fiber-resellers'];
  Completer<core.FinanceOverview>? delayedFinance;
  final searches = <String, Completer<core.CustomerSearch>>{};
  core.AppSession? _fakeSession;

  core.AppUser userFor(String workspace) => core.AppUser.fromJson({
    'id': 1,
    'username': 'demo.staff',
    'fullName': 'Demo Staff',
    'role': sectionOrigin && workspace == 'main' ? 'section_user' : role,
    if (sectionOrigin && workspace == 'main') 'sourceRole': role,
    'active': true,
    'accountKey': sectionOrigin ? 'fiber-users:1' : 'main:1',
    'permissions': [
      'dashboard.view',
      'reports.view',
      'bills.view',
      'drawer.view',
    ],
    'allowedSections': sections,
  });

  @override
  core.AppSession? get session => _fakeSession;

  @override
  Future<core.ServerInfo> connect() async {
    connectCalls++;
    return const core.ServerInfo(version: '1.43.4', needsSetup: false);
  }

  @override
  Future<core.AppSession> login(
    String username,
    String password, {
    String workspaceId = 'main',
    bool allowTemporaryHttp = false,
  }) async {
    loginCalls++;
    lastTemporaryConsent = allowTemporaryHttp;
    if (loginFailure != null) throw loginFailure!;
    return _fakeSession = core.AppSession(
      user: userFor(workspaceId),
      workspaceId: workspaceId,
    );
  }

  @override
  Future<core.AppUser?> refreshSession() async {
    refreshCalls++;
    if (expired) {
      _fakeSession = null;
      return null;
    }
    final workspace = _fakeSession!.workspaceId;
    final user = userFor(workspace);
    _fakeSession = core.AppSession(user: user, workspaceId: workspace);
    return user;
  }

  @override
  Future<core.AppSession> switchWorkspace(String workspaceId) async =>
      _fakeSession = core.AppSession(
        user: userFor(workspaceId),
        workspaceId: workspaceId,
      );

  core.FinanceOverview financeFor(String workspace) {
    final cash = workspace == 'all'
        ? 1000
        : workspace == 'fiber-users'
        ? 100
        : 200;
    return core.FinanceOverview.fromJson({
      'workspaceId': workspace,
      'workspaceName': workspace,
      'employeeName': role == 'admin' ? 'All employees' : 'Demo Staff',
      'today': '2026-10-19',
      'admin': role == 'admin',
      'wallets': [
        {'id': 'demo-wallet', 'label': 'Demo wallet', 'balance': 200},
      ],
      'dashboard': {
        'drawer': {'balance': cash},
        'recentActivity': [
          {
            'invoiceNo': 'DEMO-ACT-1',
            'activity': 'Customer payment',
            'customerName': 'Demo Customer',
            'subtotal': 30,
            'createdAt': '2026-10-19T10:00:00',
            'cashierName': 'Demo Support',
            'paymentMethod': 'Whish Money',
          },
        ],
      },
      'report': {
        'revenue': 500,
        'grossProfit': 200,
        'netProfit': 188,
        'expenses': 12,
        'whishFees': 2,
      },
      'internetCost': 300,
      'bandwidthCost': {'incurredCost': 500},
      'dashboardTotals': {
        'basis': workspace == 'all' ? 'business_sum' : 'independent_business',
        'cash': cash,
        'wallets': 200,
        'whishFees': 2,
        'otherExpenses': 10,
        'profitBeforeOther': 198,
        'profitAfterOther': 188,
        'profitKnown': true,
      },
    });
  }

  @override
  Future<core.FinanceOverview> financeOverview({
    String? workspaceId,
    String? accountKey,
  }) async {
    if (networkDown)
      throw const core.FiberApiException(
        core.ApiFailure.connection,
        'Connection unavailable.',
      );
    if (financeDenied)
      throw const core.FiberApiException(
        core.ApiFailure.permission,
        'Access denied.',
      );
    if (delayedFinance != null) return delayedFinance!.future;
    return financeFor(workspaceId ?? _fakeSession!.workspaceId);
  }

  @override
  Future<List<core.BillReceipt>> bills({
    required String startDate,
    required String endDate,
  }) async {
    billStart = startDate;
    billEnd = endDate;
    if (billsDenied)
      throw const core.FiberApiException(
        core.ApiFailure.permission,
        'Access denied.',
      );
    return [
      core.BillReceipt.fromJson({
        'id': 2,
        'receiptNo': 'DEMO-BILL-2',
        'customerName': 'Demo Customer',
        'customerAccount': 'demo.customer',
        'bundleName': 'Demo Internet 20 Mbps',
        'serviceType': 'Internet',
        'amount': 40,
        'paymentMethod': 'Whish Money',
        'paymentStatus': 'paid',
        'paidAt': '2026-10-19T10:00:00',
        'cashierName': 'Original Support',
        'renewal': {
          'state': 'unknown',
          'message': 'Review the saved provider operation.',
        },
      }),
    ];
  }

  @override
  Future<core.ResellerAccounts> resellerAccounts() async {
    if (resellersDenied)
      throw const core.FiberApiException(
        core.ApiFailure.permission,
        'Access denied.',
      );
    return core.ResellerAccounts.fromJson({
      'accounts': [
        {
          'username': 'fibernetlb2',
          'name': 'Demo Representative',
          'balanceRead': true,
          'balanceAvailable': true,
          'balance': -240.00,
          'moneyAdded': 200,
          'moneyCollected': 100,
          'pendingToCollect': 100,
        },
      ],
      'totals': {'added': 200, 'refunded': 0},
    });
  }

  @override
  Future<core.CustomerSearch> searchCustomers(String term) async {
    searchCalls++;
    if (searches.containsKey(term)) return searches[term]!.future;
    return core.CustomerSearch.fromJson({'customers': <dynamic>[], 'total': 0});
  }

  @override
  Future<bool> logout() async {
    logoutCalls++;
    _fakeSession = null;
    return true;
  }

  @override
  void dispose() {
    disposeCalls++;
    _fakeSession = null;
    super.dispose();
  }
}

core.CustomerSearch _customer(String name) => core.CustomerSearch.fromJson({
  'customers': [
    {'username': name, 'name': name, 'service': 'Demo Fiber', 'blocked': false},
  ],
  'total': 1,
});

void main() {
  const temporaryAddress = 'http://198.51.100.25:3210';
  const temporaryInput = ui.SignInInput(
    endpoint: temporaryAddress,
    username: 'demo.staff',
    password: 'demo-only',
  );

  test(
    'temporary HTTP needs exact configuration and explicit login consent',
    () async {
      var clients = 0;
      final configured = Uri.parse(temporaryAddress);
      final api = _FakeApi(
        server: configured,
        temporaryHttpEndpoint: configured,
      );
      final controller = FiberAppController(
        temporaryHttpEndpoint: configured,
        apiFactory: (_) {
          clients++;
          return api;
        },
      );
      await controller.signIn(temporaryInput);
      expect(clients, 0);
      expect(controller.isSignedIn, false);
      expect(controller.error, contains('warning'));
      await controller.signIn(temporaryInput, allowTemporaryHttp: true);
      expect(clients, 1);
      expect(api.loginCalls, 1);
      expect(api.lastTemporaryConsent, true);
      expect(controller.viewModel!.temporaryHttpActive, true);
      await controller.refresh();
      expect(controller.viewModel!.temporaryHttpActive, true);
      await controller.selectBusiness('fiber-users');
      expect(controller.viewModel!.temporaryHttpActive, true);
      await controller.signOut();
      expect(controller.viewModel, isNull);
      controller.dispose();
    },
  );

  test(
    'HTTP consent alone cannot allow an unconfigured or non-debug origin',
    () async {
      for (final debugEnabled in [true, false]) {
        var clients = 0;
        final controller = FiberAppController(
          temporaryHttpEndpoint: debugEnabled
              ? null
              : Uri.parse(temporaryAddress),
          temporaryHttpDebugEnabled: debugEnabled,
          apiFactory: (_) {
            clients++;
            throw StateError('must not construct');
          },
        );
        await controller.signIn(temporaryInput, allowTemporaryHttp: true);
        expect(clients, 0);
        expect(controller.isSignedIn, false);
        controller.dispose();
      }
    },
  );

  test('injected client cannot change the consented server endpoint', () async {
    final allowed = Uri.parse(temporaryAddress);
    final wrong = Uri.parse('http://203.0.113.70:3210');
    final api = _FakeApi(server: wrong, temporaryHttpEndpoint: wrong);
    final controller = FiberAppController(
      temporaryHttpEndpoint: allowed,
      apiFactory: (_) => api,
    );
    await controller.signIn(temporaryInput, allowTemporaryHttp: true);
    expect(controller.isSignedIn, false);
    expect(controller.viewModel, isNull);
    expect(api.connectCalls, 0);
    expect(api.loginCalls, 0);
    expect(controller.error, contains('does not match'));
    controller.dispose();
  });

  test(
    'temporary consent cannot authorize another port, origin or URI trick',
    () async {
      for (final address in [
        'http://198.51.100.26:3210',
        'http://198.51.100.25:3211',
        'http://198.51.100.25:3210/rpc',
        'http://198.51.100.25:3210//',
        'http://198.51.100.25:3210/../',
        'http://198.51.100.25:3210/%2e/',
        'http://user@198.51.100.25:3210',
        'http://@198.51.100.25:3210',
        'http://198.51.100.25:3210?',
        'http://198.51.100.25:3210#',
        'http://198.051.100.25:3210',
        'http://198.51.100.25:03210',
        'http://198.51.100.25:9999999999999999999999999999',
        'http://demo.invalid:3210',
      ]) {
        var clients = 0;
        final controller = FiberAppController(
          temporaryHttpEndpoint: Uri.parse(temporaryAddress),
          apiFactory: (_) {
            clients++;
            throw StateError('must not construct');
          },
        );
        await controller.signIn(
          ui.SignInInput(
            endpoint: address,
            username: 'demo.staff',
            password: 'demo-only',
          ),
          allowTemporaryHttp: true,
        );
        expect(clients, 0, reason: address);
        expect(controller.viewModel, isNull);
        controller.dispose();
      }
    },
  );

  test(
    'Main Admin opens all businesses using authoritative server totals',
    () async {
      final api = _FakeApi();
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      expect(controller.isSignedIn, true);
      expect(controller.viewModel!.selectedBusinessId, 'all');
      expect(controller.viewModel!.businesses.first.id, 'all');
      expect(controller.viewModel!.dashboard.cashCents, 100000);
      expect(controller.viewModel!.dashboard.revenueCents, isNull);
      expect(controller.viewModel!.dashboard.internetCostCents, isNull);
      expect(controller.viewModel!.dashboard.netProfitBeforeOtherCents, 19800);
      expect(api.refreshCalls, 1);
      expect(api.searchCalls, 0);
      controller.dispose();
    },
  );

  test(
    'section-origin Cashier opens first assigned business, not Main Admin',
    () async {
      final api = _FakeApi(role: 'cashier', sectionOrigin: true);
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      final view = controller.viewModel!;
      expect(view.role, ui.AppRole.cashier);
      expect(view.selectedBusinessId, 'fiber-users');
      expect(view.businesses.map((item) => item.id), [
        'fiber-users',
        'fiber-resellers',
      ]);
      expect(view.dashboard.whishCents, 20000);
      expect(view.dashboard.whishFeesCents, 200);
      expect(view.bills.single.renewalStatusLabel, contains('unknown'));
      expect(view.bills.single.paymentLabel, contains('paid'));
      expect(view.bills.single.operatorName, 'Original Support');
      expect(api.billStart, '2026-10-01');
      expect(api.billEnd, '2026-10-19');
      expect(api.searchCalls, 0);
      controller.dispose();
    },
  );

  test('section Admin cannot access consolidated Main Admin scope', () async {
    final api = _FakeApi(sectionOrigin: true);
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    expect(controller.viewModel!.role, ui.AppRole.admin);
    expect(controller.viewModel!.selectedBusinessId, 'fiber-users');
    expect(
      controller.viewModel!.businesses.any((item) => item.id == 'all'),
      false,
    );
    controller.dispose();
  });

  test(
    'Support keeps its role and can open Resellers without Admin elevation',
    () async {
      final api = _FakeApi(role: 'support', sectionOrigin: true)
        ..sections = ['fiber-resellers'];
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      expect(controller.viewModel!.role, ui.AppRole.support);
      expect(controller.viewModel!.selectedBusinessId, 'fiber-resellers');
      expect(controller.viewModel!.resellers.single.balanceCents, -24000);
      controller.dispose();
    },
  );

  test('unsupported roles are signed out, never cast into Cashier', () async {
    for (final role in ['manager', 'viewer', 'attendance_operator']) {
      final api = _FakeApi(role: role);
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      expect(controller.isSignedIn, false);
      expect(controller.viewModel, isNull);
      expect(controller.error, contains('supports Admin, Cashier and Support'));
      expect(api.logoutCalls, 1);
      controller.dispose();
    }
  });

  test(
    'old business balances and receipts clear before asynchronous switch',
    () async {
      final api = _FakeApi(role: 'cashier', sectionOrigin: true);
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      api.delayedFinance = Completer<core.FinanceOverview>();
      final switching = controller.selectBusiness('fiber-resellers');
      expect(controller.viewModel!.selectedBusinessId, 'fiber-resellers');
      expect(controller.viewModel!.dashboard.cashCents, isNull);
      expect(controller.viewModel!.bills, isEmpty);
      expect(controller.viewModel!.receipts, isEmpty);
      api.delayedFinance!.complete(api.financeFor('fiber-resellers'));
      await switching;
      expect(controller.viewModel!.dashboard.cashCents, 20000);
      expect(controller.viewModel!.resellers.single.username, 'fibernetlb2');
      controller.dispose();
    },
  );

  test('network-only refresh failure retains same-business verified data with warning', () async {
    final api = _FakeApi(role: 'cashier', sectionOrigin: true);
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    final lastSync = controller.viewModel!.lastSyncedLabel;
    api.networkDown = true;
    await controller.refresh();
    expect(controller.viewModel!.dashboard.cashCents, 10000);
    expect(controller.viewModel!.hasLoadedData, true);
    expect(controller.viewModel!.lastSyncedLabel, lastSync);
    expect(controller.viewModel!.errorMessage, contains('last verified data'));
    controller.dispose();
  });

  test(
    '403 finance rejection clears private cached data rather than retaining it',
    () async {
      final api = _FakeApi(role: 'cashier', sectionOrigin: true);
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      api.financeDenied = true;
      await controller.refresh();
      expect(controller.viewModel!.dashboard.cashCents, isNull);
      expect(controller.viewModel!.hasLoadedData, false);
      expect(controller.viewModel!.bills, isEmpty);
      expect(controller.viewModel!.receipts, isEmpty);
      expect(controller.viewModel!.billsMessage, contains('unavailable'));
      controller.dispose();
    },
  );

  test('expired session removes every authenticated screen value', () async {
    final api = _FakeApi();
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    api.expired = true;
    await controller.refresh();
    expect(controller.viewModel, isNull);
    expect(controller.isSignedIn, false);
    expect(controller.error, contains('session ended'));
    controller.dispose();
  });

  test('denied bills do not hide good balances or masquerade as verified emptiness', () async {
    final api = _FakeApi(role: 'cashier', sectionOrigin: true)
      ..billsDenied = true;
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    expect(controller.viewModel!.dashboard.cashCents, 10000);
    expect(controller.viewModel!.hasLoadedData, true);
    expect(controller.viewModel!.bills, isEmpty);
    expect(
      controller.viewModel!.billsMessage,
      contains('unavailable for this account'),
    );
    expect(controller.viewModel!.errorMessage, contains('Bills'));
    controller.dispose();
  });

  test(
    'denied reseller list is clearly unavailable while good balances remain',
    () async {
      final api = _FakeApi(role: 'cashier', sectionOrigin: true)
        ..sections = ['fiber-resellers']
        ..resellersDenied = true;
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      expect(controller.viewModel!.dashboard.cashCents, 20000);
      expect(controller.viewModel!.resellers, isEmpty);
      expect(controller.viewModel!.resellersMessage, contains('unavailable'));
      controller.dispose();
    },
  );

  test('customer search is explicit and a superseded result cannot replace the latest query', () async {
    final api = _FakeApi(role: 'cashier', sectionOrigin: true);
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    expect(api.searchCalls, 0);
    await controller.searchCustomers('ab');
    expect(api.searchCalls, 0);
    api.searches['first'] = Completer<core.CustomerSearch>();
    api.searches['second'] = Completer<core.CustomerSearch>();
    final first = controller.searchCustomers('first');
    final second = controller.searchCustomers('second');
    api.searches['second']!.complete(_customer('second'));
    await second;
    api.searches['first']!.complete(_customer('first'));
    await first;
    expect(controller.viewModel!.customers.single.username, 'second');
    controller.dispose();
  });

  test('sign-out during customer search discards late customer data', () async {
    final api = _FakeApi(role: 'cashier', sectionOrigin: true);
    final controller = FiberAppController(apiFactory: (_) => api);
    await controller.signIn(_input);
    api.searches['customer'] = Completer<core.CustomerSearch>();
    final pending = controller.searchCustomers('customer');
    await controller.signOut();
    api.searches['customer']!.complete(_customer('customer'));
    await pending;
    expect(controller.viewModel, isNull);
    expect(controller.isSignedIn, false);
    controller.dispose();
  });

  test(
    'role changed to unsupported during refresh ends the mobile session safely',
    () async {
      final api = _FakeApi();
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      api.role = 'manager';
      await controller.refresh();
      expect(controller.isSignedIn, false);
      expect(controller.viewModel, isNull);
      expect(controller.error, contains('supports Admin, Cashier and Support'));
      controller.dispose();
    },
  );

  test(
    'sign-out during finance refresh cannot restore the old dashboard',
    () async {
      final api = _FakeApi();
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      api.delayedFinance = Completer<core.FinanceOverview>();
      final pending = controller.refresh();
      await controller.signOut();
      api.delayedFinance!.complete(api.financeFor('all'));
      await pending;
      expect(controller.viewModel, isNull);
      expect(controller.isSignedIn, false);
      controller.dispose();
    },
  );

  test(
    'unexpected sign-in exceptions do not expose passwords or stack details',
    () async {
      final api = _FakeApi()
        ..loginFailure = StateError('secret password must not be shown');
      final controller = FiberAppController(apiFactory: (_) => api);
      await controller.signIn(_input);
      expect(controller.error, isNot(contains('secret password')));
      expect(controller.isSignedIn, false);
      controller.dispose();
    },
  );
}
