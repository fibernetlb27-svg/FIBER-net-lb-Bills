import 'dart:io';
import 'dart:ui' as image_ui;

import 'package:fiber_net_lb_mobile/application/controller.dart';
import 'package:fiber_net_lb_mobile/application/sample_data.dart';
import 'package:fiber_net_lb_mobile/main.dart';
import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const _capture = bool.fromEnvironment('CAPTURE_APP');
bool _fontsLoaded = false;

Future<void> _loadFonts(WidgetTester tester) async {
  if (_fontsLoaded) return;
  final configuredSdk = Platform.environment['FLUTTER_ROOT']?.trim();
  final sdkRoot = configuredSdk != null && configuredSdk.isNotEmpty
      ? configuredSdk
      : '../mobile-sdk/flutter';
  final directory = Directory(
    '$sdkRoot/bin/cache/artifacts/material_fonts',
  );
  await tester.runAsync(() async {
    final fonts = FontLoader('Roboto');
    for (final filename in ['roboto-regular.ttf', 'roboto-bold.ttf']) {
      fonts.addFont(
        Future.value(
          ByteData.sublistView(
            File('${directory.path}/$filename').readAsBytesSync(),
          ),
        ),
      );
    }
    await fonts.load();
    final icons = FontLoader('MaterialIcons');
    icons.addFont(
      Future.value(
        ByteData.sublistView(
          File('${directory.path}/materialicons-regular.otf').readAsBytesSync(),
        ),
      ),
    );
    await icons.load();
  });
  _fontsLoaded = true;
}

class _AppHarness {
  int clientsConstructed = 0;
  final boundary = GlobalKey();
  late final controller = FiberAppController(
    apiFactory: (_) {
      clientsConstructed++;
      throw StateError('Design preview must not create any API client.');
    },
  );

  Future<void> mount(WidgetTester tester) async {
    await _loadFonts(tester);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: FiberMobileApp(controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(FiberSignInPage), findsOneWidget);
    expect(clientsConstructed, 0);
  }

  Future<void> choose(WidgetTester tester, String label) async {
    final preview = find.byKey(const Key('open-preview'));
    await tester.ensureVisible(preview);
    await tester.pumpAndSettle();
    await tester.tap(preview);
    await tester.pumpAndSettle();
    expect(find.text('Explore the design'), findsOneWidget);
    final choice = find.text(label);
    await tester.ensureVisible(choice);
    await tester.pumpAndSettle();
    await tester.tap(choice);
    await tester.pumpAndSettle();
    expect(clientsConstructed, 0);
    expect(tester.takeException(), isNull);
  }

  Future<void> capture(WidgetTester tester, String filename) async {
    if (!_capture) return;
    for (final scroll in tester.stateList<ScrollableState>(
      find.byType(Scrollable),
    )) {
      if (scroll.position.hasContentDimensions) scroll.position.jumpTo(0);
    }
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: filename);
    final render =
        boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await render.toImage(pixelRatio: 1);
      final data = await image.toByteData(format: image_ui.ImageByteFormat.png);
      final output = Directory('qa-results/app')..createSync(recursive: true);
      File('${output.path}/$filename')
          .writeAsBytesSync(data!.buffer.asUint8List());
      image.dispose();
    });
  }

  Future<void> leavePreview(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('tab-more')));
    await tester.pumpAndSettle();
    final leave = find.byKey(const Key('sign-out'));
    await tester.ensureVisible(leave);
    await tester.pumpAndSettle();
    await tester.tap(leave);
    await tester.pumpAndSettle();
    expect(find.byType(FiberSignInPage), findsOneWidget);
    expect(controller.isSignedIn, false);
    expect(clientsConstructed, 0);
  }
}

void main() {
  testWidgets(
    'root sign-in is disconnected and never shows invented balances',
    (tester) async {
      final app = _AppHarness();
      await app.mount(tester);
      expect(find.byKey(const Key('server-endpoint')), findsOneWidget);
      expect(find.byKey(const Key('sign-in-username')), findsOneWidget);
      expect(find.byKey(const Key('sign-in-password')), findsOneWidget);
      expect(find.text(r'$0.00'), findsNothing);
      expect(find.byType(FiberWorkspacePage), findsNothing);
      await app.capture(tester, 'sign-in-390.png');
    },
  );

  testWidgets(
    'root Admin preview uses SampleData and exits without a connection',
    (tester) async {
      final app = _AppHarness();
      await app.mount(tester);
      await app.choose(tester, 'Admin dashboard');
      final page = tester.widget<FiberWorkspacePage>(
        find.byType(FiberWorkspacePage),
      );
      expect(page.viewModel.role, AppRole.admin);
      expect(page.viewModel.selectedBusinessId, 'all');
      expect(page.viewModel.previewMode, true);
      expect(page.viewModel.dashboard.cashCents, 345000);
      expect(find.byKey(const Key('preview-banner')), findsOneWidget);
      expect(find.byKey(const Key('metric-revenue')), findsNothing);
      expect(find.byKey(const Key('metric-internet-cost')), findsNothing);
      await app.capture(tester, 'admin-390.png');
      await app.leavePreview(tester);
    },
  );

  testWidgets(
    'root Cashier preview navigates, uses 300 cash and disables financial writes',
    (tester) async {
      final app = _AppHarness();
      await app.mount(tester);
      await app.choose(tester, 'Cashier dashboard');
      var page = tester.widget<FiberWorkspacePage>(
        find.byType(FiberWorkspacePage),
      );
      expect(page.viewModel.role, AppRole.cashier);
      expect(page.viewModel.selectedBusinessId, 'fiber-resellers');
      expect(page.viewModel.dashboard.cashCents, 30000);
      expect(page.viewModel.dashboard.whishCents, 125000);
      expect(page.viewModel.dashboard.whishFeesCents, 1250);
      expect(
        find.descendant(
          of: find.byKey(const Key('metric-cash')),
          matching: find.text(r'$300.00'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('metric-cash')),
          matching: find.text(r'$3,450.00'),
        ),
        findsNothing,
      );
      expect(page.onAddMoney, isNull);
      expect(page.onRefund, isNull);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Add money'),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Refund'),
            )
            .onPressed,
        isNull,
      );
      await app.capture(tester, 'cashier-390.png');

      await tester.tap(find.byKey(const Key('tab-bills')));
      await tester.pumpAndSettle();
      expect(find.text('Bills & accounts'), findsOneWidget);
      expect(find.text('fibernetlb2'), findsWidgets);
      await tester.ensureVisible(find.text('fibernetlb2').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('fibernetlb2').first);
      await tester.pumpAndSettle();
      expect(find.text('Recorded details · read only'), findsOneWidget);
      expect(find.text('Proradius balance'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('business-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('business-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('FIBER net lb Users').last);
      await tester.pumpAndSettle();
      page = tester.widget<FiberWorkspacePage>(find.byType(FiberWorkspacePage));
      expect(page.viewModel.selectedBusinessId, 'fiber-users');
      expect(
        page.viewModel.businesses.any((business) => business.id == 'all'),
        false,
      );
      final customerName = SampleData.customers.first.name;
      expect(find.text(customerName), findsOneWidget);
      await tester.ensureVisible(find.text(customerName));
      await tester.pumpAndSettle();
      await tester.tap(find.text(customerName));
      await tester.pumpAndSettle();
      expect(find.byType(FiberRenewalReviewPage), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('confirm-renewal')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('Back to customers'));
      await tester.pumpAndSettle();
      expect(find.byType(FiberWorkspacePage), findsOneWidget);
      expect(find.text('Bills & accounts'), findsOneWidget);
      await tester.tap(find.byKey(const Key('tab-receipts')));
      await tester.pumpAndSettle();
      expect(find.text('Receipts'), findsWidgets);
      await app.leavePreview(tester);
      expect(app.clientsConstructed, 0);
    },
  );

  testWidgets(
    'root Support preview remains disconnected and can leave safely',
    (tester) async {
      final app = _AppHarness();
      await app.mount(tester);
      await app.choose(tester, 'Support dashboard');
      final page = tester.widget<FiberWorkspacePage>(
        find.byType(FiberWorkspacePage),
      );
      expect(page.viewModel.role, AppRole.support);
      expect(page.viewModel.employeeName, 'Demo Support');
      expect(page.viewModel.dashboard.cashCents, 30000);
      expect(page.onAddMoney, isNull);
      expect(page.onRefund, isNull);
      await app.capture(tester, 'support-390.png');
      await app.leavePreview(tester);
    },
  );

  for (final entry in const [
    ('Renewal review', 'Review renewal', 'renewal-review-390.png'),
    ('Successful renewal', 'Renewal successful', 'renewal-success-390.png'),
    ('Incomplete renewal', 'Renewal incomplete', 'renewal-incomplete-390.png'),
  ]) {
    testWidgets(
      'root ${entry.$1} is an isolated route, not a completed transaction',
      (tester) async {
        final app = _AppHarness();
        await app.mount(tester);
        await app.choose(tester, entry.$1);
        expect(find.text(entry.$2), findsOneWidget);
        expect(find.text('DESIGN PREVIEW · Sample data'), findsOneWidget);
        expect(app.controller.isSignedIn, false);
        if (entry.$1 == 'Renewal review') {
          expect(
            tester
                .widget<FilledButton>(find.byKey(const Key('confirm-renewal')))
                .onPressed,
            isNull,
          );
          expect(
            find.text('Review only. This screen cannot submit a live renewal.'),
            findsOneWidget,
          );
        } else {
          expect(find.text('Share receipt'), findsNothing);
          expect(find.text('Confirm renewal'), findsNothing);
        }
        if (entry.$1 == 'Successful renewal') {
          expect(
            find.text('Sample success screen. No real renewal was submitted.'),
            findsOneWidget,
          );
        }
        if (entry.$1 == 'Incomplete renewal') {
          expect(find.text('Paid'), findsNothing);
          expect(find.text('Wallet credited'), findsNothing);
          expect(find.text('Renewal successful'), findsNothing);
          expect(
            find.text('Check the record before trying again'),
            findsOneWidget,
          );
        }
        await app.capture(tester, entry.$3);
        await tester.tap(find.byTooltip('Back to customers'));
        await tester.pumpAndSettle();
        expect(find.byType(FiberSignInPage), findsOneWidget);
        expect(find.byType(FiberRenewalReviewPage), findsNothing);
        expect(find.byType(FiberRenewalResultPage), findsNothing);
        expect(app.clientsConstructed, 0);
      },
    );
  }
}
