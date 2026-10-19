import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'HTTPS address and staff credentials required before submission',
    (tester) async {
      SignInInput? submitted;
      await tester.pumpWidget(
        MaterialApp(
          theme: FiberTheme.light,
          home: FiberSignInPage(onSubmit: (input) => submitted = input),
        ),
      );
      await tester.enterText(
        find.byKey(const Key('server-endpoint')),
        'http://example.test',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-username')),
        ' test.cashier ',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-password')),
        'synthetic-test-only',
      );
      await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
      await tester.tap(find.byKey(const Key('sign-in-submit')));
      await tester.pumpAndSettle();
      expect(submitted, isNull);
      expect(find.text('Enter a valid HTTPS server address.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('server-endpoint')),
        'https://example.test',
      );
      await tester.ensureVisible(find.byKey(const Key('sign-in-submit')));
      await tester.tap(find.byKey(const Key('sign-in-submit')));
      await tester.pumpAndSettle();
      expect(submitted?.endpoint, 'https://example.test');
      expect(submitted?.username, 'test.cashier');
      expect(submitted?.password, 'synthetic-test-only');
    },
  );

  testWidgets('busy sign-in cannot be submitted twice', (tester) async {
    var submissions = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: FiberTheme.light,
        home: FiberSignInPage(busy: true, onSubmit: (_) => submissions++),
      ),
    );
    final submit = tester.widget<FilledButton>(
      find.byKey(const Key('sign-in-submit')),
    );
    expect(submit.onPressed, isNull);
    expect(submissions, 0);
  });

  testWidgets('small phone with enlarged text shows sign-in without overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: FiberTheme.dark,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(2)),
          child: child!,
        ),
        home: FiberSignInPage(
          onSubmit: (_) {},
          error: 'The server could not be reached. Check the secure server address.',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
