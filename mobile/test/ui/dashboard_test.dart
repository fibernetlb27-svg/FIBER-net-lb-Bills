import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const figures = DashboardViewModel(
  revenueCents: 250000,
  internetCostCents: 160000,
  cashCents: 345000,
  whishCents: 125000,
  whishFeesCents: 1250,
  otherExpensesCents: 10000,
  netProfitBeforeOtherCents: 68750,
  netProfitAfterOtherCents: 58750,
  bandwidthCostCents: 50000,
);

Future<void> showDashboard(
  WidgetTester tester, {
  required BusinessKind kind,
  AppRole role = AppRole.admin,
  DashboardViewModel model = figures,
}) => tester.pumpWidget(
  MaterialApp(
    theme: FiberTheme.light,
    home: Scaffold(
      body: SingleChildScrollView(
        child: FiberDashboard(model: model, role: role, businessKind: kind),
      ),
    ),
  ),
);

void main() {
  test('integer money formatting never rounds through floating point', () {
    expect(formatUsd(null), '—');
    expect(formatUsd(0), r'$0.00');
    expect(formatUsd(9), r'$0.09');
    expect(formatUsd(123456789), r'$1,234,567.89');
    expect(formatUsd(-160000), r'-$1,600.00');
  });

  testWidgets('all businesses hide Revenue and Internet cost only', (
    tester,
  ) async {
    await showDashboard(tester, kind: BusinessKind.all);
    expect(find.byKey(const Key('metric-revenue')), findsNothing);
    expect(find.byKey(const Key('metric-internet-cost')), findsNothing);
    expect(find.byKey(const Key('metric-cash')), findsOneWidget);
    expect(find.byKey(const Key('metric-whish')), findsOneWidget);
    expect(find.byKey(const Key('metric-whish-fees')), findsOneWidget);
    expect(find.byKey(const Key('metric-other-expenses')), findsOneWidget);
    expect(find.byKey(const Key('metric-net-profit')), findsOneWidget);
  });

  testWidgets('Users show internet cost negative and trusted profit totals', (
    tester,
  ) async {
    await showDashboard(tester, kind: BusinessKind.users);
    expect(find.text(r'-$1,600.00'), findsOneWidget);
    expect(find.text(r'$687.50'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('deduct-other-expenses')));
    await tester.tap(find.byKey(const Key('deduct-other-expenses')));
    await tester.pump();
    expect(find.text(r'$587.50'), findsOneWidget);
    expect(find.text(r'$687.50'), findsNothing);
  });

  testWidgets('unknown after-expense profit stays unavailable, not guessed', (
    tester,
  ) async {
    await showDashboard(
      tester,
      kind: BusinessKind.all,
      model: const DashboardViewModel(
        otherExpensesCents: 500,
        netProfitBeforeOtherCents: 10000,
      ),
    );
    await tester.ensureVisible(find.byKey(const Key('deduct-other-expenses')));
    await tester.tap(find.byKey(const Key('deduct-other-expenses')));
    await tester.pump();
    final amount = tester.widget<Text>(
      find.byKey(const ValueKey('amount-Net profit')),
    );
    expect(amount.data, '—');
  });

  for (final role in [AppRole.cashier, AppRole.support]) {
    testWidgets('${role.name} Resellers contains only wallet, cash and fees', (
      tester,
    ) async {
      await showDashboard(tester, kind: BusinessKind.resellers, role: role);
      expect(find.byKey(const Key('metric-cash')), findsOneWidget);
      expect(find.byKey(const Key('metric-whish')), findsOneWidget);
      expect(find.byKey(const Key('metric-whish-fees')), findsOneWidget);
      expect(find.byKey(const Key('metric-revenue')), findsNothing);
      expect(find.byKey(const Key('metric-internet-cost')), findsNothing);
      expect(find.byKey(const Key('metric-bandwidth')), findsNothing);
      expect(find.byKey(const Key('metric-other-expenses')), findsNothing);
      expect(find.byKey(const Key('metric-net-profit')), findsNothing);
    });
  }

  testWidgets(
    'Admin Resellers include bandwidth but never Users internet cost',
    (tester) async {
      await showDashboard(tester, kind: BusinessKind.resellers);
      expect(find.byKey(const Key('metric-bandwidth')), findsOneWidget);
      expect(find.text(r'-$500.00'), findsOneWidget);
      expect(find.byKey(const Key('metric-internet-cost')), findsNothing);
    },
  );
}
