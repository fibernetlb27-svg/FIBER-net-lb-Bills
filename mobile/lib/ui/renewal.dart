import 'package:flutter/material.dart';

import 'models.dart';
import 'shared.dart';

@immutable
class RenewalReviewViewModel {
  const RenewalReviewViewModel({
    required this.customerName,
    required this.username,
    required this.businessName,
    required this.planName,
    required this.durationLabel,
    required this.amountCents,
    required this.paymentMethod,
    this.walletLabel,
    this.walletCreditCents,
    this.whishFeeCents,
    this.previewMode = false,
  });

  final String customerName;
  final String username;
  final String businessName;
  final String planName;
  final String durationLabel;
  final int amountCents;
  final String paymentMethod;
  final String? walletLabel;
  final int? walletCreditCents;
  final int? whishFeeCents;
  final bool previewMode;
}

enum RenewalOutcome { completed, incomplete, failed }

/// Outcome must come from a verified backend response or an isolated preview.
@immutable
class RenewalResultViewModel {
  const RenewalResultViewModel({
    required this.review,
    required this.outcome,
    required this.message,
    this.receiptId,
  });

  final RenewalReviewViewModel review;
  final RenewalOutcome outcome;
  final String message;
  final String? receiptId;
}

class FiberRenewalReviewPage extends StatelessWidget {
  const FiberRenewalReviewPage({
    super.key,
    required this.model,
    required this.onBack,
    this.onConfirm,
    this.busy = false,
    this.error,
  });

  final RenewalReviewViewModel model;
  final VoidCallback onBack;
  final VoidCallback? onConfirm;
  final bool busy;
  final String? error;

  @override
  Widget build(BuildContext context) => _RenewalFrame(
    title: 'Review renewal',
    businessName: model.businessName,
    onBack: busy ? null : onBack,
    preview: model.previewMode,
    children: [
      _CustomerCard(model: model),
      const SizedBox(height: 14),
      FiberPanel(
        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
        child: SizedBox(
          width: double.infinity,
          child: Column(
            children: [
              const Text('Customer payment'),
              const SizedBox(height: 8),
              Text(
                formatUsd(model.amountCents),
                style: Theme.of(context).textTheme.headlineLarge
                    ?.copyWith(color: Theme.of(context).colorScheme.primary),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 14),
      FiberPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Payment summary',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 15),
            _SummaryRow(
              'Payment method',
              model.paymentMethod,
              Icons.payments_outlined,
            ),
            if (model.walletLabel != null)
              _SummaryRow('Wallet', model.walletLabel!, Icons.wallet_outlined),
            if (model.walletCreditCents != null)
              _SummaryRow(
                'Wallet credit',
                formatUsd(model.walletCreditCents),
                Icons.add_rounded,
              ),
            if (model.whishFeeCents != null) ...[
              _SummaryRow(
                'Whish fee',
                formatUsd(model.whishFeeCents),
                Icons.percent_rounded,
              ),
              const Text(
                'Fee reduces profit only. Wallet credit stays unchanged.',
              ),
            ],
          ],
        ),
      ),
      if (error != null) ...[
        const SizedBox(height: 14),
        FiberMessage(
          title: 'Renewal was not confirmed',
          message: error!,
          icon: Icons.warning_amber_rounded,
          isError: true,
        ),
      ],
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          key: const Key('confirm-renewal'),
          onPressed: busy || model.previewMode ? null : onConfirm,
          child: Text(busy ? 'Confirming…' : 'Confirm renewal'),
        ),
      ),
      if (model.previewMode || onConfirm == null) ...[
        const SizedBox(height: 10),
        const Text('Review only. This screen cannot submit a live renewal.'),
      ],
      const SizedBox(height: 5),
      Center(
        child: TextButton(
          onPressed: busy ? null : onBack,
          child: const Text('Back to customers'),
        ),
      ),
    ],
  );
}

class FiberRenewalResultPage extends StatelessWidget {
  const FiberRenewalResultPage({
    super.key,
    required this.model,
    required this.onBackToCustomers,
    this.onViewReceipt,
    this.onShareReceipt,
  });

  final RenewalResultViewModel model;
  final VoidCallback onBackToCustomers;
  final VoidCallback? onViewReceipt;
  final VoidCallback? onShareReceipt;

  @override
  Widget build(BuildContext context) {
    final success = model.outcome == RenewalOutcome.completed;
    final pending = model.outcome == RenewalOutcome.incomplete;
    final color = success
        ? const Color(0xFF008F57)
        : pending
        ? const Color(0xFFB56A00)
        : Theme.of(context).colorScheme.error;
    final title = success
        ? 'Renewal successful'
        : pending
        ? 'Renewal incomplete'
        : 'Renewal not completed';
    return _RenewalFrame(
      title: 'Renewal status',
      businessName: model.review.businessName,
      onBack: onBackToCustomers,
      preview: model.review.previewMode,
      children: [
        Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0.65, end: 1),
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 600),
            curve: Curves.easeOutBack,
            builder: (context, scale, child) =>
                Transform.scale(scale: scale, child: child),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: CircleAvatar(
                radius: 65,
                backgroundColor: color.withAlpha(18),
                child: CircleAvatar(
                  radius: 46,
                  backgroundColor: color.withAlpha(35),
                  child: Icon(
                    success
                        ? Icons.check_rounded
                        : pending
                        ? Icons.priority_high_rounded
                        : Icons.close_rounded,
                    size: 62,
                    color: color,
                  ),
                ),
              ),
            ),
          ),
        ),
        Semantics(
          liveRegion: true,
          child: Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          model.message,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(height: 1.5),
        ),
        const SizedBox(height: 24),
        _CustomerCard(model: model.review),
        const SizedBox(height: 14),
        FiberPanel(
          child: Column(
            children: [
              _SummaryRow(
                success ? 'Paid' : 'Proposed payment',
                formatUsd(model.review.amountCents),
                Icons.payments_outlined,
              ),
              _SummaryRow(
                'Method',
                model.review.paymentMethod,
                Icons.credit_card_rounded,
              ),
              if (success && model.review.walletCreditCents != null)
                _SummaryRow(
                  'Wallet credited',
                  formatUsd(model.review.walletCreditCents),
                  Icons.wallet_outlined,
                ),
              if (model.receiptId != null)
                _SummaryRow(
                  'Receipt',
                  model.receiptId!,
                  Icons.receipt_long_outlined,
                ),
              if (success && model.review.whishFeeCents != null)
                Text(
                  'Whish fee recorded once: ${formatUsd(model.review.whishFeeCents)}.',
                ),
            ],
          ),
        ),
        if (!success) ...[
          const SizedBox(height: 14),
          const FiberMessage(
            title: 'Check the record before trying again',
            message:
                'An interrupted connection does not prove that a renewal '
                'failed. Review the receipt and account status on the desktop '
                'before submitting another renewal.',
            icon: Icons.info_outline_rounded,
          ),
        ],
        const SizedBox(height: 18),
        if (success && onShareReceipt != null && !model.review.previewMode) ...[
          FilledButton.icon(
            onPressed: onShareReceipt,
            icon: const Icon(Icons.ios_share_rounded),
            label: const Text('Share receipt'),
          ),
          const SizedBox(height: 10),
        ],
        if (model.receiptId != null && onViewReceipt != null) ...[
          OutlinedButton.icon(
            onPressed: onViewReceipt,
            icon: const Icon(Icons.receipt_long_outlined),
            label: const Text('View receipt'),
          ),
          const SizedBox(height: 7),
        ],
        TextButton(
          onPressed: onBackToCustomers,
          child: const Text('Back to customers'),
        ),
      ],
    );
  }
}

class _RenewalFrame extends StatelessWidget {
  const _RenewalFrame({
    required this.title,
    required this.businessName,
    required this.onBack,
    required this.children,
    required this.preview,
  });

  final String title;
  final String businessName;
  final VoidCallback? onBack;
  final List<Widget> children;
  final bool preview;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: IconButton(
        tooltip: 'Back to customers',
        onPressed: onBack,
        icon: const Icon(Icons.arrow_back_rounded),
      ),
      title: Text(title),
      bottom: preview
          ? PreferredSize(
              preferredSize: Size.fromHeight(
                FiberPreviewBadge.barHeight(context),
              ),
              child: const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: FiberPreviewBadge(),
              ),
            )
          : null,
    ),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 25),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FiberBrand(compact: true),
                const SizedBox(height: 14),
                Text(
                  businessName,
                  style: Theme.of(context).textTheme.labelLarge,
                  textAlign: TextAlign.right,
                ),
                const SizedBox(height: 18),
                ...children,
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _CustomerCard extends StatelessWidget {
  const _CustomerCard({required this.model});

  final RenewalReviewViewModel model;

  @override
  Widget build(BuildContext context) => FiberPanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(
                Icons.person_rounded,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    model.customerName,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 3),
                  Text(model.username),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 17),
        const Divider(),
        const SizedBox(height: 12),
        _SummaryRow('Plan', model.planName, Icons.wifi_rounded),
        _SummaryRow(
          'Duration',
          model.durationLabel,
          Icons.calendar_month_rounded,
        ),
      ],
    ),
  );
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 13),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 22, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 11),
        Expanded(
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            runSpacing: 5,
            spacing: 15,
            children: [
              Text(label),
              Text(value, style: Theme.of(context).textTheme.labelLarge),
            ],
          ),
        ),
      ],
    ),
  );
}
