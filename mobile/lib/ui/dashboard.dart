import 'package:flutter/material.dart';

import 'models.dart';
import 'shared.dart';
import 'theme.dart';

/// Only renders server-fed figures. No cash, wallet or ledger mutation happens here.
class FiberDashboard extends StatefulWidget {
  const FiberDashboard({
    super.key,
    required this.model,
    required this.role,
    required this.businessKind,
    this.showHeading = true,
  });

  final DashboardViewModel model;
  final AppRole role;
  final BusinessKind businessKind;
  final bool showHeading;

  @override
  State<FiberDashboard> createState() => _FiberDashboardState();
}

class _FiberDashboardState extends State<FiberDashboard> {
  bool _deductOtherExpenses = false;

  @override
  void didUpdateWidget(covariant FiberDashboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessKind != widget.businessKind ||
        oldWidget.role != widget.role) {
      _deductOtherExpenses = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final model = widget.model;
    final consolidated = widget.businessKind == BusinessKind.all;
    final cashierResellers =
        widget.businessKind == BusinessKind.resellers &&
        widget.role != AppRole.admin;
    final tiles = <Widget>[
      if (!consolidated && !cashierResellers)
        _MetricCard(
          key: const Key('metric-revenue'),
          label: 'Revenue',
          cents: model.revenueCents,
          icon: Icons.insights_rounded,
          hint: model.revenueHint,
        ),
      if (!cashierResellers && widget.businessKind == BusinessKind.users)
        _MetricCard(
          key: const Key('metric-internet-cost'),
          label: 'Internet cost',
          cents: model.internetCostCents == null
              ? null
              : -model.internetCostCents!.abs(),
          icon: Icons.language_rounded,
          hint: 'Included in direct costs, not deducted again',
        ),
      if (cashierResellers)
        _MetricCard(
          key: const Key('metric-whish'),
          label: 'Whish wallets',
          cents: model.whishCents,
          icon: Icons.phone_android_rounded,
          hint: consolidated
              ? 'Combined gross wallet balances'
              : 'Gross recorded wallet balance',
          accent: FiberColors.orange,
          horizontal: true,
        ),
      _MetricCard(
        key: const Key('metric-cash'),
        label: consolidated ? 'Cash drawers' : 'Cash drawer',
        cents: model.cashCents,
        icon: Icons.account_balance_wallet_outlined,
        hint: consolidated
            ? 'Combined recorded cash across businesses'
            : 'Recorded cash balance',
        horizontal: cashierResellers,
      ),
      if (!cashierResellers)
        _MetricCard(
          key: const Key('metric-whish'),
          label: 'Whish wallets',
          cents: model.whishCents,
          icon: Icons.wallet_outlined,
          hint: consolidated
              ? 'Combined gross wallet balances'
              : 'Gross recorded wallet balance',
          accent: FiberColors.orange,
        ),
      _MetricCard(
        key: const Key('metric-whish-fees'),
        label: 'Whish fees',
        cents: model.whishFeesCents,
        icon: Icons.percent_rounded,
        hint: 'Deducted from profit, not wallet credit',
        accent: cashierResellers ? FiberColors.orange : null,
        horizontal: cashierResellers,
      ),
      if (!cashierResellers && widget.businessKind == BusinessKind.resellers)
        _MetricCard(
          key: const Key('metric-bandwidth'),
          label: 'Bandwidth cost',
          cents: model.bandwidthCostCents == null
              ? null
              : -model.bandwidthCostCents!.abs(),
          icon: Icons.settings_ethernet_rounded,
          hint: 'Full purchase cost, including unpaid bills',
        ),
      if (!cashierResellers)
        _MetricCard(
          key: const Key('metric-other-expenses'),
          label: 'Other expenses',
          cents: model.otherExpensesCents,
          icon: Icons.receipt_outlined,
          hint: 'Excludes Whish fees and bandwidth cost',
          footer: CheckboxListTile(
            key: const Key('deduct-other-expenses'),
            value: _deductOtherExpenses,
            onChanged: model.otherExpensesCents == null
                ? null
                : (value) => setState(() {
                    _deductOtherExpenses = value ?? false;
                  }),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
            title: const Text(
              'Deduct expenses',
              style: TextStyle(fontSize: 12),
            ),
          ),
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.showHeading) ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  consolidated ? 'All businesses' : 'Money & activity',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(model.periodLabel, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 16),
        ],
        LayoutBuilder(
          builder: (context, constraints) {
            final scaled = MediaQuery.textScalerOf(context).scale(16) / 16;
            final columns = cashierResellers
                ? 1
                : constraints.maxWidth >= 760 && scaled < 1.5
                ? 3
                : constraints.maxWidth >= 300 && scaled < 1.3
                ? 2
                : 1;
            final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: tiles
                  .map((tile) => SizedBox(width: width, child: tile))
                  .toList(),
            );
          },
        ),
        if (!cashierResellers) ...[
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: _MetricCard(
              key: const Key('metric-net-profit'),
              label: 'Net profit',
              cents: _deductOtherExpenses
                  ? model.netProfitAfterOtherCents
                  : model.netProfitBeforeOtherCents,
              icon: Icons.bar_chart_rounded,
              prominent: true,
              horizontal: true,
              hint:
                  '${_deductOtherExpenses ? 'After' : 'Before'} other expenses. '
                  '${model.netProfitHint}',
            ),
          ),
        ],
        const SizedBox(height: 17),
        Text(
          consolidated
              ? 'Each business is calculated separately. The totals combine '
                    'those results; internal transfers are not new income.'
              : 'Recorded app balances, not live balances from Whish. '
                    'Internal transfers do not create new income.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(height: 1.6),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    super.key,
    required this.label,
    required this.cents,
    required this.icon,
    required this.hint,
    this.footer,
    this.accent,
    this.prominent = false,
    this.horizontal = false,
  });

  final String label;
  final int? cents;
  final IconData icon;
  final String hint;
  final Widget? footer;
  final Color? accent;
  final bool prominent;
  final bool horizontal;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final foreground = prominent ? Colors.white : scheme.onSurface;
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact =
            constraints.maxWidth < 240 &&
            MediaQuery.textScalerOf(context).scale(12) <= 15;
        final content = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!horizontal) ...[
              Icon(
                icon,
                size: compact ? 26 : 29,
                color: accent ?? scheme.primary,
              ),
              SizedBox(height: compact ? 9 : 13),
            ],
            Text(
              label,
              style: Theme.of(context).textTheme.labelLarge
                  ?.copyWith(color: foreground),
            ),
            const SizedBox(height: 7),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                formatUsd(cents),
                key: ValueKey('amount-$label'),
                style: Theme.of(context).textTheme.headlineMedium
                    ?.copyWith(color: foreground, fontWeight: FontWeight.w800),
              ),
            ),
            if (!compact) ...[
              const SizedBox(height: 7),
              Text(
                hint,
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: foreground, height: 1.5),
              ),
            ],
            if (footer != null) ...[const SizedBox(height: 8), footer!],
          ],
        );
        return Tooltip(
          message: hint,
          child: FiberPanel(
            padding: EdgeInsets.all(
              horizontal
                  ? 18
                  : compact
                  ? 14
                  : 16,
            ),
            backgroundColor: prominent ? FiberColors.navy : null,
            borderColor: prominent ? FiberColors.navy : null,
            child: horizontal
                ? Row(
                    children: [
                      Icon(
                        icon,
                        size: prominent ? 38 : 35,
                        color: prominent
                            ? const Color(0xFF9CCAFF)
                            : accent ?? scheme.primary,
                      ),
                      const SizedBox(width: 17),
                      Expanded(child: content),
                    ],
                  )
                : content,
          ),
        );
      },
    );
  }
}
