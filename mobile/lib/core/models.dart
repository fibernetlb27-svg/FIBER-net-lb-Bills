/// Models for the verified desktop 1.43.4 wire contract. Missing money is null,
/// not zero: a mobile screen must not invent a balance when access is denied.
typedef JsonMap = Map<String, dynamic>;

JsonMap jsonObject(dynamic value) => value is Map
    ? value.map((key, value) => MapEntry(key.toString(), value))
    : <String, dynamic>{};

List<dynamic> jsonList(dynamic value) => value is List ? value : const [];

String jsonText(dynamic value) => value is String ? value : '';

bool jsonFlag(dynamic value) => value == true || value == 1;

/// Only finite, exact USD cents within JavaScript's safe integer range.
double? usdAmount(dynamic value) {
  if (value is! num || !value.isFinite) return null;
  final scaled = value.toDouble() * 100;
  if (scaled.abs() > 9007199254740991) return null;
  final rounded = scaled.round();
  if ((scaled - rounded).abs() > 0.000001) return null;
  return rounded / 100;
}

double? _sum(Iterable<double?> values) {
  var cents = 0;
  for (final value in values) {
    if (value == null) return null;
    cents += (value * 100).round();
    if (cents.abs() > 9007199254740991) return null;
  }
  return cents / 100;
}

int? _count(dynamic value) => value is int && value >= 0 ? value : null;

class Workspace {
  const Workspace(this.id, this.name);
  final String id;
  final String name;

  static const catalog = <Workspace>[
    Workspace('main', 'Main dashboard'),
    Workspace('fiber-users', 'FIBER net lb Users'),
    Workspace('fiber-resellers', 'FIBER net lb Resellers'),
    Workspace('iptv', 'IPTV'),
    Workspace('printer', 'Printer'),
    Workspace('studio', 'Studio'),
    Workspace('mobile-ogero', 'Mobile and Ogero'),
  ];

  static Workspace? find(String id) {
    for (final workspace in catalog) {
      if (workspace.id == id) return workspace;
    }
    return null;
  }
}

class ServerInfo {
  const ServerInfo({required this.version, required this.needsSetup});
  final String version;
  final bool needsSetup;
}

class AppUser {
  AppUser.fromJson(JsonMap json)
    : id = json['id'] is int ? json['id'] as int : 0,
      username = jsonText(json['username']),
      fullName = jsonText(json['fullName']),
      role = jsonText(json['role']),
      sourceRole = jsonText(json['sourceRole']),
      active = jsonFlag(json['active']),
      accountKey = jsonText(json['accountKey']),
      permissions = Set.unmodifiable(
        jsonList(json['permissions']).whereType<String>(),
      ),
      allowedSections = Set.unmodifiable(
        jsonList(json['allowedSections']).whereType<String>(),
      );

  final int id;
  final String username;
  final String fullName;
  final String role;
  final String sourceRole;
  final bool active;
  final String accountKey;
  final Set<String> permissions;
  final Set<String> allowedSections;
  String get effectiveRole => role == 'section_user' ? sourceRole : role;
  bool get isAdmin => role == 'admin';
  bool can(String permission) => permissions.contains(permission);

  /// Main permits sign-in and section selection even for section-origin staff.
  List<Workspace> get allowedWorkspaces => List.unmodifiable(
    Workspace.catalog.where(
      (workspace) =>
          workspace.id == 'main' || allowedSections.contains(workspace.id),
    ),
  );
}

class AppSession {
  const AppSession({required this.user, required this.workspaceId});
  final AppUser user;
  final String workspaceId;
  Workspace get workspace => Workspace.find(workspaceId)!;
  // Deliberately no token/password. Secrets remain only inside FiberApiClient.
}

class WalletBalance {
  WalletBalance.fromJson(JsonMap json)
    : id = jsonText(json['id']),
      label = jsonText(json['label']),
      number = jsonText(json['number']),
      active = jsonFlag(json['active']),
      balance = usdAmount(json['balance']);
  final String id;
  final String label;
  final String number;
  final bool active;
  final double? balance;
}

class ActivityRecord {
  ActivityRecord.fromJson(JsonMap json)
    : reference = jsonText(json['invoiceNo']),
      title = jsonText(json['activity']),
      customerName = jsonText(json['customerName']),
      cashierName = jsonText(json['cashierName']),
      createdAt = jsonText(json['createdAt']),
      paymentMethod = jsonText(json['paymentMethod']),
      amount = usdAmount(json['subtotal']);
  final String reference;
  final String title;
  final String customerName;
  final String cashierName;
  final String createdAt;
  final String paymentMethod;
  final double? amount;
}

class FinanceOverview {
  FinanceOverview._({
    required this.workspaceId,
    required this.workspaceName,
    required this.employeeName,
    required this.admin,
    required this.aggregate,
    required this.today,
    required this.cash,
    required this.walletTotal,
    required this.whishFees,
    required this.revenue,
    required this.internetCost,
    required this.bandwidthCost,
    required this.otherExpenses,
    required this.profitBeforeOther,
    required this.profitAfterOther,
    required this.profitKnown,
    required this.wallets,
    required this.activity,
    required this.warning,
  });

  factory FinanceOverview.fromJson(JsonMap json) {
    final report = jsonObject(json['report']);
    final dashboard = jsonObject(json['dashboard']);
    final totals = jsonObject(json['dashboardTotals']);
    final id = jsonText(json['workspaceId']);
    final admin = jsonFlag(json['admin']);
    final aggregate = id == 'all';
    final totalsValid =
        admin &&
        totals['basis'] ==
            (aggregate ? 'business_sum' : 'independent_business');
    final wallets = List<WalletBalance>.unmodifiable(
      jsonList(json['wallets'])
          .map((row) => WalletBalance.fromJson(jsonObject(row))),
    );
    final cash = totalsValid
        ? usdAmount(totals['cash'])
        : usdAmount(jsonObject(dashboard['drawer'])['balance']);
    final walletTotal = totalsValid
        ? usdAmount(totals['wallets'])
        : json['wallets'] is List
        ? _sum(wallets.map((wallet) => wallet.balance))
        : null;
    final fees = totalsValid
        ? usdAmount(totals['whishFees'])
        : usdAmount(report['whishFees'] ?? json['whishFees']);
    final bandwidth = usdAmount(
      jsonObject(json['bandwidthCost'])['incurredCost'],
    );
    // Admin balances/profits come from the server's own business calculation.
    // No fallback to a guessed formula if these authoritative totals are absent.
    double? other;
    double? before;
    double? after;
    var profitKnown = false;
    if (admin) {
      other = totalsValid ? usdAmount(totals['otherExpenses']) : null;
      profitKnown = totalsValid && totals['profitKnown'] == true;
      before = profitKnown ? usdAmount(totals['profitBeforeOther']) : null;
      after = profitKnown ? usdAmount(totals['profitAfterOther']) : null;
    } else {
      // Staff's report already accounts for direct costs. These are the exact
      // two presentation choices used by the existing desktop, not new income.
      final expenses = usdAmount(report['expenses']);
      final gross = usdAmount(report['grossProfit']);
      other = _sum([expenses, if (fees != null) -fees else null]);
      before = _sum([gross, if (fees != null) -fees else null]);
      after = usdAmount(report['netProfit']);
      profitKnown = before != null && after != null;
    }
    profitKnown = profitKnown && before != null && after != null;
    final policy = jsonObject(json['whishFeePolicy']);
    return FinanceOverview._(
      workspaceId: id,
      workspaceName: jsonText(json['workspaceName']),
      employeeName: jsonText(json['employeeName']),
      admin: admin,
      aggregate: aggregate,
      today: jsonText(json['today']),
      cash: cash,
      walletTotal: walletTotal,
      whishFees: fees,
      revenue: aggregate
          ? null
          : admin && id == 'fiber-resellers'
          ? _sum([cash, walletTotal])
          : usdAmount(report['revenue']),
      internetCost: id == 'fiber-users'
          ? usdAmount(json['internetCost'])
          : null,
      bandwidthCost: admin && id == 'fiber-resellers' ? bandwidth : null,
      otherExpenses: other,
      profitBeforeOther: profitKnown ? before : null,
      profitAfterOther: profitKnown ? after : null,
      profitKnown: profitKnown,
      wallets: wallets,
      activity: List<ActivityRecord>.unmodifiable(
        jsonList(dashboard['recentActivity'])
            .map((row) => ActivityRecord.fromJson(jsonObject(row))),
      ),
      warning: jsonText(policy['reason']),
    );
  }

  final String workspaceId;
  final String workspaceName;
  final String employeeName;
  final bool admin;
  final bool aggregate;
  final String today;
  final double? cash;
  final double? walletTotal;
  final double? whishFees;
  final double? revenue;
  final double? internetCost;
  final double? bandwidthCost;
  final double? otherExpenses;
  final double? profitBeforeOther;
  final double? profitAfterOther;
  final bool profitKnown;
  final List<WalletBalance> wallets;
  final List<ActivityRecord> activity;
  final String warning;
  double? netProfit({bool deductOtherExpenses = false}) =>
      deductOtherExpenses ? profitAfterOther : profitBeforeOther;
}

class ResellerAccount {
  ResellerAccount.fromJson(JsonMap json)
    : username = jsonText(json['username']),
      name = jsonText(json['name']),
      balance = json['balanceRead'] == true && json['balanceAvailable'] == true
          ? usdAmount(json['balance'])
          : null,
      balanceError = jsonText(json['balanceError']),
      moneyAdded = usdAmount(json['moneyAdded']),
      moneyCollected = usdAmount(json['moneyCollected']),
      toCollect = usdAmount(json['pendingToCollect']),
      refunded = usdAmount(json['moneyRefunded']);
  final String username;
  final String name;
  final double? balance;
  final String balanceError;
  final double? moneyAdded;
  final double? moneyCollected;
  final double? toCollect;
  final double? refunded;
}

class ResellerAccounts {
  ResellerAccounts.fromJson(JsonMap json)
    : accounts = List.unmodifiable(
        jsonList(json['accounts'])
            .map((row) => ResellerAccount.fromJson(jsonObject(row))),
      ),
      moneyAdded = usdAmount(jsonObject(json['totals'])['added']),
      refunded = usdAmount(jsonObject(json['totals'])['refunded']),
      note = jsonText(json['note']);
  final List<ResellerAccount> accounts;
  final double? moneyAdded;
  final double? refunded;
  final String note;
}

class BillReceipt {
  BillReceipt.fromJson(JsonMap json)
    : id = _count(json['id']),
      receiptNo = jsonText(json['receiptNo']),
      customerAccount = jsonText(json['customerAccount']),
      customerName = jsonText(json['customerName']),
      phone = jsonText(json['phone']),
      serviceType = jsonText(json['serviceType']),
      bundleName = jsonText(json['bundleName']),
      amount = usdAmount(json['amount']),
      paymentMethod = jsonText(json['paymentMethod']),
      paymentStatus = jsonText(json['paymentStatus']),
      paidAt = jsonText(json['paidAt']),
      cashierName = jsonText(json['cashierName']),
      renewalState = jsonText(jsonObject(json['renewal'])['state']),
      renewalMessage = jsonText(jsonObject(json['renewal'])['message']),
      requestedMonths = _count(jsonObject(json['renewal'])['requestedMonths']),
      completedMonths = _count(jsonObject(json['renewal'])['completedMonths']);
  final int? id;
  final String receiptNo;
  final String customerAccount;
  final String customerName;
  final String phone;
  final String serviceType;
  final String bundleName;
  final double? amount;
  final String paymentMethod;
  final String paymentStatus;
  final String paidAt;
  final String cashierName;
  final String renewalState;
  final String renewalMessage;
  final int? requestedMonths;
  final int? completedMonths;

  /// A paid receipt is not proof that Proradius completed the renewal.
  bool get renewalConfirmed =>
      const {'succeeded', 'created', 'free'}.contains(renewalState);
}

class InternetCustomer {
  InternetCustomer.fromJson(JsonMap json)
    : username = jsonText(json['username']),
      name = jsonText(json['name']),
      phone = jsonText(json['phone']),
      service = jsonText(json['service']),
      expiry = jsonText(json['expiry']),
      blocked = jsonFlag(json['blocked']);
  final String username;
  final String name;
  final String phone;
  final String service;
  final String expiry;
  final bool blocked;
}

class CustomerSearch {
  CustomerSearch.fromJson(JsonMap json)
    : customers = List.unmodifiable(
        jsonList(json['customers'])
            .map((row) => InternetCustomer.fromJson(jsonObject(row))),
      ),
      total = _count(json['total']);
  final List<InternetCustomer> customers;
  final int? total;
}
