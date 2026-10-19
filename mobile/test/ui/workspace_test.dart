import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'dashboard_test.dart' show figures;

const businesses = [
  BusinessOption(id: 'all', name: 'All businesses', kind: BusinessKind.all),
  BusinessOption(
    id: 'users',
    name: 'FIBER net lb Users',
    kind: BusinessKind.users,
  ),
  BusinessOption(
    id: 'resellers',
    name: 'FIBER net lb Resellers',
    kind: BusinessKind.resellers,
  ),
];

const receipt = ActivityItem(
  id: 'PREVIEW-0042',
  title: 'Preview reseller',
  description: 'Sample funding receipt for an isolated UI test',
  amountCents: 20000,
  dateLabel: '19 Oct 2026',
  status: ActivityStatus.completed,
  paymentLabel: 'Whish Money',
  operatorName: 'Test Cashier',
);

WorkspaceViewModel workspace({
  AppRole role = AppRole.admin,
  String business = 'all',
  bool preview = false,
  bool loading = false,
  String? error,
  bool hasLoadedData = true,
}) => WorkspaceViewModel(
  employeeName: 'Test Admin',
  username: 'preview.user',
  role: role,
  serverLabel: 'https://example.test',
  businesses: businesses,
  selectedBusinessId: business,
  dashboard: figures,
  receipts: const [receipt],
  bills: const [receipt],
  customers: const [
    CustomerItem(
      id: 'c1',
      username: 'preview.customer',
      name: 'Preview Customer',
      planLabel: '25 Mbps',
      statusLabel: 'Active',
      expiryLabel: '19 Nov 2026',
    ),
  ],
  resellers: const [
    ResellerItem(
      id: 'r1',
      username: 'preview.reseller',
      name: 'Preview Reseller',
      balanceCents: -12000,
      moneyAddedCents: 20000,
      moneyCollectedCents: 10000,
      toCollectCents: 10000,
    ),
  ],
  previewMode: preview,
  loading: loading,
  errorMessage: error,
  hasLoadedData: hasLoadedData,
);

Future<void> pumpWorkspace(
  WidgetTester tester,
  WorkspaceViewModel model, {
  ThemeData? theme,
  double textScale = 1,
  ValueChanged<String>? onBusinessChanged,
  VoidCallback? onAddMoney,
  VoidCallback? onRefund,
  Future<void> Function()? onRefresh,
}) => tester.pumpWidget(
  MaterialApp(
    theme: theme ?? FiberTheme.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: FiberWorkspacePage(
      viewModel: model,
      onBusinessChanged: onBusinessChanged ?? (_) {},
      onRefresh: onRefresh ?? () async {},
      onSignOut: () {},
      onAddMoney: onAddMoney,
      onRefund: onRefund,
    ),
  ),
);

Finder tab(String label) => find.byKey(Key('tab-${label.toLowerCase()}'));

void main() {
  testWidgets('server-fed Bills and Receipts open recorded details', (
    tester,
  ) async {
    await pumpWorkspace(tester, workspace(business: 'users'));
    await tester.tap(tab('Bills'));
    await tester.pumpAndSettle();
    expect(find.text('Preview Customer'), findsOneWidget);
    await tester.tap(find.text('Preview Customer'));
    await tester.pumpAndSettle();
    expect(find.text('preview.customer'), findsWidgets);
    expect(find.text('Recorded details · read only'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    await tester.tap(tab('Receipts'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Preview reseller'));
    await tester.pumpAndSettle();
    expect(find.text('PREVIEW-0042'), findsOneWidget);
    expect(find.text('Test Cashier'), findsOneWidget);
  });

  testWidgets(
    'Reseller balances and money-collected details use supplied data',
    (tester) async {
      await pumpWorkspace(
        tester,
        workspace(role: AppRole.cashier, business: 'resellers'),
      );
      await tester.tap(tab('Bills'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('preview.reseller'));
      await tester.pumpAndSettle();
      expect(find.text('Proradius balance'), findsOneWidget);
      expect(find.text(r'-$120.00'), findsOneWidget);
      expect(find.text('Money collected'), findsOneWidget);
    },
  );

  testWidgets('preview explicitly disconnected and disables money callbacks', (
    tester,
  ) async {
    var actions = 0;
    await pumpWorkspace(
      tester,
      workspace(role: AppRole.cashier, business: 'resellers', preview: true),
      onAddMoney: () => actions++,
      onRefund: () => actions++,
    );
    expect(find.byKey(const Key('preview-banner')), findsOneWidget);
    final add = find.widgetWithText(FilledButton, 'Add money');
    await tester.ensureVisible(add);
    expect(tester.widget<FilledButton>(add).onPressed, isNull);
    expect(
      tester
          .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Refund'))
          .onPressed,
      isNull,
    );
    expect(actions, 0);
  });

  testWidgets('disconnected state never presents missing figures as zero', (
    tester,
  ) async {
    final model = WorkspaceViewModel(
      employeeName: 'Test',
      username: 'test',
      role: AppRole.cashier,
      serverLabel: 'https://example.test',
      businesses: businesses,
      selectedBusinessId: 'resellers',
      errorMessage: 'The server is unavailable.',
    );
    await pumpWorkspace(tester, model);
    expect(find.byKey(const Key('connection-error')), findsOneWidget);
    expect(find.text('—'), findsNWidgets(3));
    expect(find.text(r'$0.00'), findsNothing);
  });

  testWidgets(
    'iOS uses the approved underline tab bar and real tab navigation',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await pumpWorkspace(
        tester,
        workspace(business: 'users', preview: true),
        textScale: 2,
        theme: FiberTheme.light.copyWith(platform: TargetPlatform.iOS),
      );
      expect(find.byKey(const Key('ios-tab-bar')), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      await tester.tap(tab('Bills'));
      await tester.pumpAndSettle();
      expect(find.text('Preview Customer'), findsOneWidget);
      await tester.tap(tab('Receipts'));
      await tester.pumpAndSettle();
      expect(find.text('Preview reseller'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'list read failures show unknown status, not a verified empty list',
    (tester) async {
      final model = WorkspaceViewModel(
        employeeName: 'Test',
        username: 'test',
        role: AppRole.cashier,
        serverLabel: 'https://example.test',
        businesses: businesses,
        selectedBusinessId: 'resellers',
        resellersMessage: 'This account cannot view reseller information.',
        receiptsMessage: 'Receipt information did not load.',
      );
      await pumpWorkspace(tester, model);
      expect(find.text('No receipts to display'), findsNothing);
      await tester.tap(tab('Bills'));
      await tester.pumpAndSettle();
      expect(
        find.text('This account cannot view reseller information.'),
        findsOneWidget,
      );
      expect(find.text('No accounts to display'), findsNothing);
      await tester.tap(tab('Receipts'));
      await tester.pumpAndSettle();
      expect(find.text('Receipt information did not load.'), findsOneWidget);
      expect(find.text('No receipts to display'), findsNothing);
    },
  );

  for (final width in [320.0, 390.0, 840.0]) {
    for (final scale in [1.0, 2.0]) {
      for (final dark in [false, true]) {
        testWidgets('layout $width / text $scale / dark $dark has no overflow', (
          tester,
        ) async {
          tester.view.physicalSize = Size(width, 1100);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          for (final model in [
            workspace(),
            workspace(business: 'users'),
            workspace(role: AppRole.cashier, business: 'resellers'),
          ]) {
            await pumpWorkspace(
              tester,
              model,
              textScale: scale,
              theme: dark ? FiberTheme.dark : FiberTheme.light,
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            for (final label in ['Bills', 'Receipts', 'More']) {
              await tester.tap(tab(label));
              await tester.pumpAndSettle();
              expect(tester.takeException(), isNull);
            }
            // A new identity recreates the local navigation and checkbox state.
            await tester.pumpWidget(const SizedBox.shrink());
          }
        });
      }
    }
  }
}
