import 'package:fiber_net_lb_mobile/main.dart' as app;
import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const testEndpoint = 'http://192.0.2.10:3210';

Future<void> pumpSignIn(
  WidgetTester tester, {
  required ValueChanged<SignInInput> onSubmit,
  String? configured = testEndpoint,
  String initial = testEndpoint,
  double scale = 1,
}) => tester.pumpWidget(
  MaterialApp(
    theme: FiberTheme.light,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: FiberSignInPage(
      initialEndpoint: initial,
      temporaryHttpEndpoint: configured,
      onSubmit: onSubmit,
    ),
  ),
);

Future<void> enterCredentials(WidgetTester tester) async {
  await tester.enterText(
    find.byKey(const Key('sign-in-username')),
    'test.cashier',
  );
  await tester.enterText(
    find.byKey(const Key('sign-in-password')),
    'synthetic-only',
  );
}

void main() {
  test('temporary endpoint is only canonical exact HTTP IPv4 origin', () {
    expect(matchesTemporaryHttpEndpoint(testEndpoint, testEndpoint), isTrue);
    expect(
      matchesTemporaryHttpEndpoint('$testEndpoint/', testEndpoint),
      isTrue,
    );
    for (final endpoint in [
      'http://192.0.2.11:3210',
      'http://192.0.2.10:3211',
      'http://192.0.2.10:03210',
      'http://192.0.2.10',
      'https://192.0.2.10:3210',
      '$testEndpoint/api',
      '$testEndpoint/?',
      '$testEndpoint/#',
      'http://user@192.0.2.10:3210',
      'http://@192.0.2.10:3210',
      'http://192.000.002.010:3210',
      'http://999.0.2.10:3210',
      'http://example.test:3210',
      'http://[::1]:3210',
      'http://192.0.2.10:0',
      'http://192.0.2.10:65536',
      'http://192.0.2.10:9999999999999999999999999999',
    ]) {
      expect(
        matchesTemporaryHttpEndpoint(endpoint, testEndpoint),
        isFalse,
        reason: endpoint,
      );
    }
    expect(matchesTemporaryHttpEndpoint(testEndpoint, null), isFalse);
    expect(canonicalTemporaryHttpEndpoint(''), isNull);
  });

  test(
    'main integration enables temporary origin only on Android debug native',
    () {
      expect(
        app.temporaryHttpEndpointForPlatform(
          debugMode: true,
          isWeb: false,
          platform: TargetPlatform.android,
          configuredEndpoint: testEndpoint,
        ),
        Uri.parse(testEndpoint),
      );
      for (final platform in TargetPlatform.values) {
        if (platform == TargetPlatform.android) continue;
        expect(
          app.temporaryHttpEndpointForPlatform(
            debugMode: true,
            isWeb: false,
            platform: platform,
            configuredEndpoint: testEndpoint,
          ),
          isNull,
        );
      }
      expect(
        app.temporaryHttpEndpointForPlatform(
          debugMode: false,
          isWeb: false,
          platform: TargetPlatform.android,
          configuredEndpoint: testEndpoint,
        ),
        isNull,
      );
      expect(
        app.temporaryHttpEndpointForPlatform(
          debugMode: true,
          isWeb: true,
          platform: TargetPlatform.android,
          configuredEndpoint: testEndpoint,
        ),
        isNull,
      );
      expect(
        app.temporaryHttpEndpointForPlatform(
          debugMode: true,
          isWeb: false,
          platform: TargetPlatform.android,
          configuredEndpoint: '',
        ),
        isNull,
      );
    },
  );

  testWidgets('HTTP credentials cannot submit without affirmative consent', (
    tester,
  ) async {
    final submissions = <SignInInput>[];
    await pumpSignIn(tester, onSubmit: submissions.add);
    await enterCredentials(tester);
    await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
    expect(
      find.byKey(const Key('temporary-http-sign-in-warning')),
      findsOneWidget,
    );
    expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isFalse);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('sign-in-submit')))
          .onPressed,
      isNull,
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(submissions, isEmpty);

    await tester.ensureVisible(find.byType(Checkbox));
    await tester.tap(find.byType(Checkbox));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
    await tester.tap(find.byKey(const Key('sign-in-submit')));
    await tester.pumpAndSettle();
    expect(submissions, hasLength(1));
    expect(submissions.single.endpoint, testEndpoint);
    expect(submissions.single.allowTemporaryHttp, isTrue);
    expect(
      tester.widget<Checkbox>(find.byType(Checkbox)).value,
      isFalse,
      reason: 'Every subsequent login attempt needs fresh consent.',
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('sign-in-submit')))
          .onPressed,
      isNull,
    );
  });

  testWidgets(
    'endpoint changes revoke consent and HTTPS never passes HTTP consent',
    (tester) async {
      final submissions = <SignInInput>[];
      await pumpSignIn(tester, onSubmit: submissions.add);
      await tester.ensureVisible(find.byType(Checkbox));
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('server-endpoint')),
        '$testEndpoint/api',
      );
      await tester.pumpAndSettle();
      expect(find.byType(Checkbox), findsNothing);
      await tester.enterText(
        find.byKey(const Key('server-endpoint')),
        testEndpoint,
      );
      await tester.pumpAndSettle();
      expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isFalse);

      await tester.enterText(
        find.byKey(const Key('server-endpoint')),
        'https://example.test',
      );
      await enterCredentials(tester);
      await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
      await tester.tap(find.byKey(const Key('sign-in-submit')));
      await tester.pumpAndSettle();
      expect(submissions, hasLength(1));
      expect(submissions.single.allowTemporaryHttp, isFalse);
      expect(
        find.byKey(const Key('temporary-http-sign-in-warning')),
        findsNothing,
      );
    },
  );

  testWidgets('unconfigured HTTP stays rejected with no opt-in bypass', (
    tester,
  ) async {
    var submitted = false;
    await pumpSignIn(
      tester,
      configured: null,
      onSubmit: (_) => submitted = true,
    );
    await enterCredentials(tester);
    await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
    await tester.tap(find.byKey(const Key('sign-in-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid HTTPS server address.'), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);
    expect(submitted, isFalse);
  });

  testWidgets(
    'temporary warning persists across tabs and disables money actions',
    (tester) async {
      var actions = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: FiberTheme.light,
          home: FiberWorkspacePage(
            viewModel: const WorkspaceViewModel(
              employeeName: 'Test Cashier',
              username: 'test.cashier',
              role: AppRole.cashier,
              serverLabel: testEndpoint,
              businesses: [
                BusinessOption(
                  id: 'resellers',
                  name: 'Resellers',
                  kind: BusinessKind.resellers,
                ),
              ],
              selectedBusinessId: 'resellers',
              temporaryHttpActive: true,
            ),
            onBusinessChanged: (_) {},
            onRefresh: () async {},
            onSignOut: () {},
            onAddMoney: () => actions++,
            onRefund: () => actions++,
          ),
        ),
      );
      final warning = find.byKey(const Key('temporary-http-live-warning'));
      final position = tester.getTopLeft(warning);
      expect(warning, findsOneWidget);
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Add money'),
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Add money'),
            )
            .onPressed,
        isNull,
      );
      expect(tester.getTopLeft(warning), position);
      for (final tab in ['bills', 'receipts', 'more']) {
        await tester.tap(find.byKey(Key('tab-$tab')));
        await tester.pumpAndSettle();
        expect(tester.getTopLeft(warning), position);
      }
      expect(actions, 0);
    },
  );

  testWidgets('HTTP risk disclosure fits a small phone with 2x text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await pumpSignIn(tester, onSubmit: (_) {}, scale: 2);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('temporary-http-sign-in-warning')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
