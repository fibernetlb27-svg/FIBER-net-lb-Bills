import '../ui/fiber_ui.dart' as ui;

/// Isolated presentation data. Never sent to the API or mixed with a session.
abstract final class SampleData {
  static const businesses = <ui.BusinessOption>[
    ui.BusinessOption(
      id: 'all',
      name: 'All businesses',
      kind: ui.BusinessKind.all,
    ),
    ui.BusinessOption(
      id: 'fiber-users',
      name: 'FIBER net lb Users',
      kind: ui.BusinessKind.users,
    ),
    ui.BusinessOption(
      id: 'fiber-resellers',
      name: 'FIBER net lb Resellers',
      kind: ui.BusinessKind.resellers,
    ),
    ui.BusinessOption(id: 'iptv', name: 'IPTV', kind: ui.BusinessKind.other),
    ui.BusinessOption(
      id: 'printer',
      name: 'Printer',
      kind: ui.BusinessKind.other,
    ),
    ui.BusinessOption(
      id: 'studio',
      name: 'Studio',
      kind: ui.BusinessKind.other,
    ),
    ui.BusinessOption(
      id: 'mobile-ogero',
      name: 'Mobile and Ogero',
      kind: ui.BusinessKind.other,
    ),
  ];

  static const receipts = <ui.ActivityItem>[
    ui.ActivityItem(
      id: 'DEMO-0042',
      title: 'fibernetlb2',
      description: 'Reseller funding · sample',
      amountCents: 20000,
      dateLabel: 'Today · 10:42',
      status: ui.ActivityStatus.completed,
      paymentLabel: 'Whish',
      operatorName: 'Demo Cashier',
    ),
    ui.ActivityItem(
      id: 'DEMO-0041',
      title: 'reseller.demo.a',
      description: 'Reseller funding · sample',
      amountCents: 10000,
      dateLabel: 'Today · 10:15',
      status: ui.ActivityStatus.completed,
      paymentLabel: 'Cash',
      operatorName: 'Demo Cashier',
    ),
    ui.ActivityItem(
      id: 'DEMO-0040',
      title: 'reseller.demo.b',
      description: 'Reseller funding · sample',
      amountCents: 5000,
      dateLabel: 'Today · 09:50',
      status: ui.ActivityStatus.completed,
      paymentLabel: 'Whish',
      operatorName: 'Demo Cashier',
    ),
  ];

  static const customers = <ui.CustomerItem>[
    ui.CustomerItem(
      id: 'ahmad.demo',
      username: 'ahmad.demo',
      name: 'Ahmad Ali',
      planLabel: '25 Mbps',
      statusLabel: 'Sample customer',
      expiryLabel: 'Demonstration only',
    ),
    ui.CustomerItem(
      id: 'sara.demo',
      username: 'sara.demo',
      name: 'Sara Demo',
      planLabel: '50 Mbps',
      statusLabel: 'Sample customer',
      expiryLabel: 'Demonstration only',
    ),
  ];

  static const resellers = <ui.ResellerItem>[
    ui.ResellerItem(
      id: 'fibernetlb2',
      username: 'fibernetlb2',
      name: 'FIBER net lb Users representative',
      balanceCents: -24000,
      moneyAddedCents: 20000,
      moneyCollectedCents: 0,
      toCollectCents: 20000,
    ),
    ui.ResellerItem(
      id: 'reseller.demo.a',
      username: 'reseller.demo.a',
      name: 'Demo reseller',
      balanceCents: 10000,
      moneyAddedCents: 10000,
      moneyCollectedCents: 0,
      toCollectCents: 10000,
    ),
    ui.ResellerItem(
      id: 'reseller.demo.b',
      username: 'reseller.demo.b',
      name: 'Demo reseller',
      balanceCents: 5000,
      moneyAddedCents: 5000,
      moneyCollectedCents: 0,
      toCollectCents: 5000,
    ),
  ];

  static ui.WorkspaceViewModel workspace(ui.AppRole role, String businessId) {
    final admin = role == ui.AppRole.admin;
    final all = businessId == 'all';
    final users = businessId == 'fiber-users';
    return ui.WorkspaceViewModel(
      employeeName: admin
          ? 'Demo Admin'
          : role == ui.AppRole.support
          ? 'Demo Support'
          : 'Demo Cashier',
      username: 'preview.${role.name}',
      role: role,
      serverLabel: 'No server connected',
      businesses: businesses
          .where((business) => admin || business.id != 'all')
          .toList(growable: false),
      selectedBusinessId: businessId,
      previewMode: true,
      hasLoadedData: true,
      lastSyncedLabel: 'Sample data · not a live balance',
      dashboard: ui.DashboardViewModel(
        cashCents: all ? 345000 : 30000,
        whishCents: 125000,
        whishFeesCents: 1250,
        otherExpensesCents: 10000,
        netProfitBeforeOtherCents: 68750,
        netProfitAfterOtherCents: 58750,
        revenueCents: users ? 250000 : null,
        internetCostCents: users ? -160000 : null,
        bandwidthCostCents: !users && !all && admin ? 50000 : null,
        periodLabel: 'This month · Sample data',
      ),
      bills: receipts,
      receipts: receipts,
      customers: users ? customers : const [],
      resellers: businessId == 'fiber-resellers' ? resellers : const [],
    );
  }

  static const renewal = ui.RenewalReviewViewModel(
    customerName: 'Ahmad Ali',
    username: 'ahmad.demo',
    businessName: 'FIBER net lb Users',
    planName: '25 Mbps',
    durationLabel: '1 month',
    amountCents: 2500,
    paymentMethod: 'Whish Money',
    walletLabel: 'FIBER net lb',
    walletCreditCents: 2500,
    whishFeeCents: 25,
    previewMode: true,
  );
}
