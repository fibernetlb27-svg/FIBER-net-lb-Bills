import 'dart:io';
import 'dart:ui' as ui;

import 'package:fiber_net_lb_mobile/application/sample_data.dart';
import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const captureEnabled = bool.fromEnvironment('CAPTURE_UI');

void main() {
  testWidgets('capture actual Flutter screens with SDK fonts', (tester) async {
    final fontDirectory = Directory(
      '../mobile-sdk/flutter/bin/cache/artifacts/material_fonts',
    );
    expect(
      fontDirectory.existsSync(),
      isTrue,
      reason: 'Use the verified Flutter SDK fonts for rendered screenshots.',
    );
    await tester.runAsync(() async {
      final loader = FontLoader('Roboto');
      for (final filename in ['roboto-regular.ttf', 'roboto-bold.ttf']) {
        final bytes = File('${fontDirectory.path}/$filename').readAsBytesSync();
        loader.addFont(Future.value(ByteData.sublistView(bytes)));
      }
      await loader.load();
      final icons = FontLoader('MaterialIcons');
      icons.addFont(
        Future.value(
          ByteData.sublistView(
            File('${fontDirectory.path}/materialicons-regular.otf')
                .readAsBytesSync(),
          ),
        ),
      );
      await icons.load();
    });

    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final output = Directory('qa-results/ui')..createSync(recursive: true);

    final screens = <(String, TargetPlatform, Widget)>[
      (
        'temporary-http-consent-390.png',
        TargetPlatform.android,
        FiberSignInPage(
          initialEndpoint: 'http://192.0.2.10:3210',
          temporaryHttpEndpoint: 'http://192.0.2.10:3210',
          onSubmit: (_) {},
        ),
      ),
      (
        'admin-android-390.png',
        TargetPlatform.android,
        FiberWorkspacePage(
          viewModel: SampleData.workspace(AppRole.admin, 'all'),
          onBusinessChanged: (_) {},
          onRefresh: () async {},
          onSignOut: () {},
        ),
      ),
      (
        'cashier-android-390.png',
        TargetPlatform.android,
        FiberWorkspacePage(
          viewModel: SampleData.workspace(AppRole.cashier, 'fiber-resellers'),
          onBusinessChanged: (_) {},
          onRefresh: () async {},
          onSignOut: () {},
        ),
      ),
      (
        'admin-ios-390.png',
        TargetPlatform.iOS,
        FiberWorkspacePage(
          viewModel: SampleData.workspace(AppRole.admin, 'all'),
          onBusinessChanged: (_) {},
          onRefresh: () async {},
          onSignOut: () {},
        ),
      ),
      (
        'renewal-review-390.png',
        TargetPlatform.android,
        FiberRenewalReviewPage(model: SampleData.renewal, onBack: () {}),
      ),
      (
        'renewal-success-390.png',
        TargetPlatform.android,
        FiberRenewalResultPage(
          model: const RenewalResultViewModel(
            review: SampleData.renewal,
            outcome: RenewalOutcome.completed,
            message: '1 month renewed · isolated design example',
            receiptId: 'PREVIEW-0042',
          ),
          onBackToCustomers: () {},
        ),
      ),
      (
        'renewal-incomplete-390.png',
        TargetPlatform.android,
        FiberRenewalResultPage(
          model: const RenewalResultViewModel(
            review: SampleData.renewal,
            outcome: RenewalOutcome.incomplete,
            message: 'The server has not confirmed every requested month.',
          ),
          onBackToCustomers: () {},
        ),
      ),
    ];

    for (final screen in screens) {
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: FiberTheme.light.copyWith(platform: screen.$2),
            home: screen.$3,
          ),
        ),
      );
      await tester.pumpAndSettle();
      if (screen.$1 == 'temporary-http-consent-390.png') {
        await tester.ensureVisible(
          find.byKey(const Key('temporary-http-consent')),
        );
        await tester.pumpAndSettle();
      }
      for (final scrollable in tester.stateList<ScrollableState>(
        find.byType(Scrollable),
      )) {
        if (scrollable.position.hasContentDimensions)
          scrollable.position.jumpTo(0);
      }
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: screen.$1);
      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        expect(png, isNotNull);
        File('${output.path}/${screen.$1}')
            .writeAsBytesSync(png!.buffer.asUint8List());
        image.dispose();
      });
      await tester.pumpWidget(const SizedBox.shrink());
    }
  }, skip: !captureEnabled);
}
