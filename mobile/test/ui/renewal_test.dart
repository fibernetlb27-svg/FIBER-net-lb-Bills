import 'package:fiber_net_lb_mobile/ui/fiber_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const review = RenewalReviewViewModel(
  customerName: 'Preview Customer',
  username: 'preview.customer',
  businessName: 'FIBER net lb Users',
  planName: '25 Mbps',
  durationLabel: '1 month',
  amountCents: 2500,
  paymentMethod: 'Whish Money',
  walletLabel: 'Preview wallet',
  walletCreditCents: 2500,
  whishFeeCents: 25,
  previewMode: true,
);

void main() {
  testWidgets('preview review cannot submit a live renewal', (tester) async {
    var submitted = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: FiberTheme.light,
        home: FiberRenewalReviewPage(
          model: review,
          onBack: () {},
          onConfirm: () => submitted++,
        ),
      ),
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('confirm-renewal')),
    );
    expect(button.onPressed, isNull);
    expect(find.text('DESIGN PREVIEW · Sample data'), findsOneWidget);
    expect(find.text(r'$25.00'), findsNWidgets(2));
    expect(submitted, 0);
  });

  testWidgets('incomplete result never reports paid or wallet credited', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: FiberTheme.light,
        home: FiberRenewalResultPage(
          model: const RenewalResultViewModel(
            review: review,
            outcome: RenewalOutcome.incomplete,
            message: 'The server did not confirm all requested months.',
          ),
          onBackToCustomers: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Renewal incomplete'), findsOneWidget);
    expect(find.text('Proposed payment'), findsOneWidget);
    expect(find.text('Paid'), findsNothing);
    expect(find.text('Wallet credited'), findsNothing);
    expect(find.text('Renewal successful'), findsNothing);
    expect(find.text('Check the record before trying again'), findsOneWidget);
  });

  testWidgets('review and incomplete status fit 320px and large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final page in [
      FiberRenewalReviewPage(model: review, onBack: () {}),
      FiberRenewalResultPage(
        model: const RenewalResultViewModel(
          review: review,
          outcome: RenewalOutcome.incomplete,
          message: 'Check the account before retrying.',
        ),
        onBackToCustomers: () {},
      ),
    ]) {
      await tester.pumpWidget(
        MaterialApp(
          theme: FiberTheme.dark,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(2)),
            child: child!,
          ),
          home: page,
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
  });
}
