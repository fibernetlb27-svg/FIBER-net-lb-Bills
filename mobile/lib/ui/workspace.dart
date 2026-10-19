import 'package:flutter/material.dart';

import 'dashboard.dart';
import 'models.dart';
import 'shared.dart';
import 'theme.dart';

enum WorkspaceSection { bandwidth, expenses, reports }

class FiberWorkspacePage extends StatefulWidget {
  const FiberWorkspacePage({
    super.key,
    required this.viewModel,
    required this.onBusinessChanged,
    required this.onRefresh,
    required this.onSignOut,
    this.onCustomerSearch,
    this.onCustomerSelected,
    this.onResellerSelected,
    this.onReceiptSelected,
    this.onBillSelected,
    this.onOpenSection,
    this.onAddMoney,
    this.onRefund,
  });

  final WorkspaceViewModel viewModel;
  final ValueChanged<String> onBusinessChanged;
  final Future<void> Function() onRefresh;
  final VoidCallback onSignOut;
  final ValueChanged<String>? onCustomerSearch;
  final ValueChanged<CustomerItem>? onCustomerSelected;
  final ValueChanged<ResellerItem>? onResellerSelected;
  final ValueChanged<ActivityItem>? onReceiptSelected;
  final ValueChanged<ActivityItem>? onBillSelected;
  final ValueChanged<WorkspaceSection>? onOpenSection;

  /// Null until the host supplies a verified, permission-checked write workflow.
  final VoidCallback? onAddMoney;
  final VoidCallback? onRefund;

  @override
  State<FiberWorkspacePage> createState() => _FiberWorkspacePageState();
}

class _FiberWorkspacePageState extends State<FiberWorkspacePage> {
  int _tab = 0;
  String _search = '';

  WorkspaceViewModel get model => widget.viewModel;

  @override
  void didUpdateWidget(covariant FiberWorkspacePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.viewModel.selectedBusinessId != model.selectedBusinessId) {
      _search = '';
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: model.previewMode
        ? PreferredSize(
            preferredSize: Size.fromHeight(
              FiberPreviewBadge.barHeight(context),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 6),
                child: const FiberPreviewBadge(key: Key('preview-banner')),
              ),
            ),
          )
        : model.temporaryHttpActive
        ? PreferredSize(
            preferredSize: Size.fromHeight(
              FiberTemporaryHttpBanner.barHeight(context),
            ),
            child: const SafeArea(
              bottom: false,
              child: Padding(
                padding: EdgeInsets.fromLTRB(20, 6, 20, 6),
                child: FiberTemporaryHttpBanner(
                  key: Key('temporary-http-live-warning'),
                ),
              ),
            ),
          )
        : null,
    bottomNavigationBar: Theme.of(context).platform == TargetPlatform.iOS
        ? _iosNavigation(context)
        : NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (index) => setState(() => _tab = index),
            destinations: const [
              NavigationDestination(
                key: Key('tab-home'),
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home_rounded),
                label: 'Home',
              ),
              NavigationDestination(
                key: Key('tab-bills'),
                icon: Icon(Icons.description_outlined),
                selectedIcon: Icon(Icons.description_rounded),
                label: 'Bills',
              ),
              NavigationDestination(
                key: Key('tab-receipts'),
                icon: Icon(Icons.receipt_long_outlined),
                selectedIcon: Icon(Icons.receipt_long_rounded),
                label: 'Receipts',
              ),
              NavigationDestination(
                key: Key('tab-more'),
                icon: Icon(Icons.more_horiz_rounded),
                label: 'More',
              ),
            ],
          ),
    body: SafeArea(
      child: RefreshIndicator(
        onRefresh: widget.onRefresh,
        child: ListView(
          key: PageStorageKey('workspace-$_tab'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 26),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 920),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _header(context),
                    const SizedBox(height: 23),
                    if (model.errorMessage != null) ...[
                      FiberMessage(
                        key: const Key('connection-error'),
                        title: model.hasLoadedData
                            ? 'Connection interrupted'
                            : 'Unable to load this workspace',
                        message:
                            '${model.errorMessage!}'
                            '${model.hasLoadedData ? ' Displayed figures are from the last successful refresh.' : ' Figures stay unavailable until the server responds.'}',
                        icon: Icons.cloud_off_rounded,
                        isError: true,
                        onRetry: model.loading ? null : widget.onRefresh,
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (model.loading) ...[
                      Semantics(
                        label: 'Refreshing workspace',
                        liveRegion: true,
                        child: const LinearProgressIndicator(),
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (_tab != 3) ...[
                      Text(
                        _tab == 0
                            ? model.role == AppRole.admin
                                  ? 'Overview'
                                  : 'My dashboard'
                            : _tab == 1
                            ? 'Bills & accounts'
                            : 'Receipts',
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      const SizedBox(height: 16),
                      _businessSelector(context),
                      const SizedBox(height: 12),
                      Text(
                        '${model.employeeScopeLabel ?? (model.role == AppRole.admin ? 'All employees' : 'My activity')}'
                        ' · ${model.dashboard.periodLabel}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (model.lastSyncedLabel != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Last refreshed ${model.lastSyncedLabel}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                      const SizedBox(height: 20),
                    ],
                    switch (_tab) {
                      0 => _home(context),
                      1 => _bills(context),
                      2 => _receipts(context),
                      _ => _more(context),
                    },
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _iosNavigation(BuildContext context) {
    const labels = ['Home', 'Bills', 'Receipts', 'More'];
    const icons = [
      Icons.home_outlined,
      Icons.description_outlined,
      Icons.receipt_long_outlined,
      Icons.more_horiz_rounded,
    ];
    const selectedIcons = [
      Icons.home_rounded,
      Icons.description_rounded,
      Icons.receipt_long_rounded,
      Icons.more_horiz_rounded,
    ];
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const Key('ios-tab-bar'),
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var index = 0; index < labels.length; index++)
              Expanded(
                child: Semantics(
                  button: true,
                  selected: _tab == index,
                  child: InkWell(
                    key: Key('tab-${labels[index].toLowerCase()}'),
                    onTap: () => setState(() => _tab = index),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(3, 12, 3, 7),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _tab == index ? selectedIcons[index] : icons[index],
                            color: _tab == index
                                ? scheme.primary
                                : scheme.onSurfaceVariant,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            labels[index],
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: _tab == index
                                      ? scheme.primary
                                      : scheme.onSurfaceVariant,
                                ),
                          ),
                          const SizedBox(height: 5),
                          Container(
                            width: 32,
                            height: 3,
                            decoration: BoxDecoration(
                              color: _tab == index
                                  ? scheme.primary
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) => Row(
    children: [
      const Expanded(child: FiberBrand(compact: true)),
      const SizedBox(width: 8),
      if (MediaQuery.textScalerOf(context).scale(12) <= 16) ...[
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
          decoration: BoxDecoration(
            color: model.role == AppRole.admin
                ? Theme.of(context).colorScheme.primaryContainer
                : FiberColors.orange.withAlpha(25),
            borderRadius: BorderRadius.circular(30),
          ),
          child: Text(
            roleLabel(model.role),
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ),
        const SizedBox(width: 8),
      ],
      Tooltip(
        message: '${model.employeeName} · ${roleLabel(model.role)}',
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: () => setState(() => _tab = 3),
          child: CircleAvatar(
            backgroundColor: FiberColors.navy,
            foregroundColor: Colors.white,
            child: Text(_initials(model.employeeName)),
          ),
        ),
      ),
    ],
  );

  Widget _businessSelector(BuildContext context) {
    final selected = model.selectedBusiness;
    if (model.businesses.isEmpty) {
      return const FiberMessage(
        title: 'No assigned businesses',
        message: 'Ask your Admin to check your account permissions.',
        icon: Icons.business_outlined,
      );
    }
    return InputDecorator(
      decoration: const InputDecoration(
        labelText: 'Business',
        contentPadding: EdgeInsets.symmetric(horizontal: 15, vertical: 4),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: const Key('business-selector'),
          value: selected?.id,
          isExpanded: true,
          hint: const Text('Choose a business'),
          icon: const Icon(Icons.expand_more_rounded),
          items: model.businesses
              .map(
                (business) => DropdownMenuItem(
                  value: business.id,
                  child: Text(business.name, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(),
          onChanged: model.loading
              ? null
              : (value) {
                  if (value != null) widget.onBusinessChanged(value);
                },
        ),
      ),
    );
  }

  Widget _home(BuildContext context) {
    final business = model.selectedBusiness;
    if (business == null) {
      return const FiberEmptyState(
        title: 'Choose a workspace',
        message: 'Select a permitted business to load your figures.',
        icon: Icons.business_outlined,
      );
    }
    final cashierResellers =
        business.kind == BusinessKind.resellers && model.role != AppRole.admin;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FiberDashboard(
          key: ValueKey('dashboard-${business.id}-${model.role.name}'),
          model: model.dashboard,
          role: model.role,
          businessKind: business.kind,
          showHeading: false,
        ),
        if (cashierResellers) ...[
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final stack =
                  constraints.maxWidth < 340 ||
                  MediaQuery.textScalerOf(context).scale(14) > 18;
              final buttons = [
                SizedBox(
                  width: stack
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 10) / 2,
                  child: FilledButton.icon(
                    onPressed:
                        !model.previewMode &&
                            !model.temporaryHttpActive &&
                            model.errorMessage == null
                        ? widget.onAddMoney
                        : null,
                    icon: const Icon(Icons.add_circle_outline_rounded),
                    label: const Text('Add money'),
                  ),
                ),
                SizedBox(
                  width: stack
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 10) / 2,
                  child: OutlinedButton.icon(
                    onPressed:
                        !model.previewMode &&
                            !model.temporaryHttpActive &&
                            model.errorMessage == null
                        ? widget.onRefund
                        : null,
                    icon: const Icon(Icons.undo_rounded),
                    label: const Text('Refund'),
                  ),
                ),
              ];
              return Wrap(spacing: 10, runSpacing: 10, children: buttons);
            },
          ),
          if (widget.onAddMoney == null ||
              model.previewMode ||
              model.temporaryHttpActive) ...[
            const SizedBox(height: 8),
            Text(
              'Financial changes remain in the desktop app in this mobile preview.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
        if (model.role == AppRole.admin) ...[
          const SizedBox(height: 25),
          Text('Main office', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          _officeLinks(context),
        ],
        const SizedBox(height: 23),
        Row(
          children: [
            Expanded(
              child: Text(
                'Recent receipts',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            TextButton(
              onPressed: () => setState(() => _tab = 2),
              child: const Text('View all'),
            ),
          ],
        ),
        const SizedBox(height: 7),
        if (model.receiptsMessage != null) ...[
          FiberMessage(
            title: 'Receipt information unavailable',
            message: model.receiptsMessage!,
            icon: Icons.info_outline_rounded,
          ),
          const SizedBox(height: 12),
        ],
        if (model.receipts.isEmpty && model.receiptsMessage == null)
          const FiberEmptyState(
            title: 'No receipts to display',
            message: 'Receipts appear here after they are recorded in the app.',
          )
        else if (model.receipts.isNotEmpty)
          FiberPanel(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (
                  var index = 0;
                  index < model.receipts.length && index < 3;
                  index++
                ) ...[
                  if (index != 0) const Divider(indent: 17, endIndent: 17),
                  _activityTile(
                    context,
                    model.receipts[index],
                    isReceipt: true,
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _bills(BuildContext context) {
    final isResellers = model.selectedBusiness?.kind == BusinessKind.resellers;
    final query = _search.trim().toLowerCase();
    final customers = model.customers.where(
      (item) => '${item.name} ${item.username}'.toLowerCase().contains(query),
    );
    final resellers = model.resellers.where(
      (item) => '${item.name} ${item.username}'.toLowerCase().contains(query),
    );
    final accountsMessage = isResellers
        ? model.resellersMessage
        : model.customersMessage;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          key: ValueKey('account-search-${model.selectedBusinessId}'),
          decoration: InputDecoration(
            hintText: isResellers ? 'Search resellers' : 'Search customers',
            prefixIcon: const Icon(Icons.search_rounded),
          ),
          onChanged: (value) {
            setState(() => _search = value);
            if (!isResellers) widget.onCustomerSearch?.call(value);
          },
        ),
        const SizedBox(height: 18),
        if (accountsMessage != null) ...[
          FiberMessage(
            title: 'Account information unavailable',
            message: accountsMessage,
            icon: Icons.info_outline_rounded,
          ),
          const SizedBox(height: 12),
        ],
        if (isResellers && resellers.isNotEmpty)
          ...resellers.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FiberPanel(
                padding: EdgeInsets.zero,
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 17,
                    vertical: 8,
                  ),
                  leading: _personIcon(context),
                  title: Text(item.username),
                  subtitle: Text(
                    '${item.name}\nProradius balance ${formatUsd(item.balanceCents)}'
                    '\nTo collect ${formatUsd(item.toCollectCents)}',
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => widget.onResellerSelected != null
                      ? widget.onResellerSelected!(item)
                      : _showDetails(context, item.username, [
                          ('Name', item.name),
                          ('Proradius balance', formatUsd(item.balanceCents)),
                          ('Money added', formatUsd(item.moneyAddedCents)),
                          (
                            'Money collected',
                            formatUsd(item.moneyCollectedCents),
                          ),
                          ('To collect', formatUsd(item.toCollectCents)),
                        ]),
                ),
              ),
            ),
          )
        else if (!isResellers && customers.isNotEmpty)
          ...customers.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FiberPanel(
                padding: EdgeInsets.zero,
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 17,
                    vertical: 8,
                  ),
                  leading: _personIcon(context),
                  title: Text(item.name.isEmpty ? item.username : item.name),
                  subtitle: Text(
                    [
                      item.username,
                      if (item.planLabel != null) item.planLabel!,
                      if (item.statusLabel != null) item.statusLabel!,
                    ].join(' · '),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => widget.onCustomerSelected != null
                      ? widget.onCustomerSelected!(item)
                      : _showDetails(context, item.name, [
                          ('Username', item.username),
                          ('Plan', item.planLabel ?? 'Not supplied'),
                          ('Status', item.statusLabel ?? 'Not supplied'),
                          ('Expires', item.expiryLabel ?? 'Not supplied'),
                          ('Balance', formatUsd(item.balanceCents)),
                        ]),
                ),
              ),
            ),
          )
        else if (accountsMessage == null)
          FiberEmptyState(
            title: query.isEmpty
                ? 'No accounts to display'
                : 'No matching accounts',
            message: query.isEmpty
                ? 'Refresh to load the accounts available to your staff role.'
                : 'Try a different name or username.',
            icon: Icons.people_outline_rounded,
          ),
        if (model.billsMessage != null) ...[
          const SizedBox(height: 18),
          FiberMessage(
            title: 'Bill information unavailable',
            message: model.billsMessage!,
            icon: Icons.info_outline_rounded,
          ),
        ],
        if (model.bills.isNotEmpty) ...[
          const SizedBox(height: 18),
          Text('Recorded bills', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          FiberPanel(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var index = 0; index < model.bills.length; index++) ...[
                  if (index != 0) const Divider(indent: 17, endIndent: 17),
                  _activityTile(context, model.bills[index], isReceipt: false),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 17),
        const FiberMessage(
          title: 'View-only mobile access',
          message:
              'Use the desktop app for renewals and financial changes. '
              'This build cannot submit credits, refunds or transfers.',
          icon: Icons.verified_user_outlined,
        ),
      ],
    );
  }

  Widget _receipts(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (model.receiptsMessage != null) ...[
        FiberMessage(
          title: 'Receipt information unavailable',
          message: model.receiptsMessage!,
          icon: Icons.info_outline_rounded,
        ),
        const SizedBox(height: 12),
      ],
      if (model.receipts.isEmpty && model.receiptsMessage == null)
        const FiberEmptyState(
          title: 'No receipts to display',
          message: 'Refresh to load receipts within your account permissions.',
        ),
      if (model.receipts.isNotEmpty)
        FiberPanel(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var index = 0; index < model.receipts.length; index++) ...[
                if (index != 0) const Divider(indent: 17, endIndent: 17),
                _activityTile(context, model.receipts[index], isReceipt: true),
              ],
            ],
          ),
        ),
    ],
  );

  Widget _activityTile(
    BuildContext context,
    ActivityItem item, {
    required bool isReceipt,
  }) => ListTile(
    contentPadding: const EdgeInsets.symmetric(horizontal: 17, vertical: 7),
    leading: _personIcon(context),
    title: Text(item.title),
    subtitle: Text(
      '${item.paymentLabel == null ? '' : '${item.paymentLabel} · '}'
      '${formatUsd(item.amountCents)}\n${item.dateLabel}'
      '${MediaQuery.textScalerOf(context).scale(12) > 16 ? ' · ${_statusLabel(item.status)}' : ''}'
      '${item.renewalStatusLabel == null ? '' : '\nRenewal: ${item.renewalStatusLabel}'}',
    ),
    trailing: MediaQuery.textScalerOf(context).scale(12) > 16
        ? const Icon(Icons.chevron_right_rounded)
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                decoration: BoxDecoration(
                  color: item.status == ActivityStatus.completed
                      ? const Color(0xFFDDF7E9)
                      : Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _statusLabel(item.status),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: item.status == ActivityStatus.completed
                        ? const Color(0xFF006B3F)
                        : Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
    onTap: () {
      final handler = isReceipt
          ? widget.onReceiptSelected
          : widget.onBillSelected;
      if (handler != null) {
        handler(item);
      } else {
        _showDetails(context, item.title, [
          ('Receipt', item.id),
          ('Amount', formatUsd(item.amountCents)),
          ('Status', _statusLabel(item.status)),
          ('Date', item.dateLabel),
          ('Payment method', item.paymentLabel ?? 'Not supplied'),
          if (item.operatorName != null) ('Recorded by', item.operatorName!),
          if (item.renewalStatusLabel != null)
            ('Renewal status', item.renewalStatusLabel!),
          if (item.renewalMessage != null)
            ('Renewal details', item.renewalMessage!),
          ('Description', item.description),
        ]);
      }
    },
  );

  Widget _more(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text('Your workspace', style: Theme.of(context).textTheme.headlineMedium),
      const SizedBox(height: 19),
      FiberPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              model.employeeName,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 5),
            Text('${model.username} · ${roleLabel(model.role)}'),
            const SizedBox(height: 20),
            const Divider(),
            const SizedBox(height: 17),
            Text(
              model.previewMode ? 'Preview mode' : 'Connected server',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 6),
            SelectableText(
              model.previewMode ? 'Not connected' : model.serverLabel,
            ),
            const SizedBox(height: 12),
            const Text(
              'Only records allowed by your staff role are requested.',
            ),
          ],
        ),
      ),
      if (model.role == AppRole.admin) ...[
        const SizedBox(height: 24),
        Text('Main office', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _officeLinks(context),
      ],
      const SizedBox(height: 20),
      SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          key: const Key('refresh-workspace'),
          onPressed: model.loading ? null : widget.onRefresh,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Refresh workspace'),
        ),
      ),
      const SizedBox(height: 20),
      const FiberMessage(
        title: 'Same company records',
        message:
            'Mobile access does not create a separate database. '
            'Your Main PC must remain running and reachable.',
        icon: Icons.dns_outlined,
      ),
      const SizedBox(height: 23),
      SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          key: const Key('sign-out'),
          onPressed: widget.onSignOut,
          icon: const Icon(Icons.logout_rounded),
          label: Text(model.previewMode ? 'Leave preview' : 'Sign out'),
        ),
      ),
    ],
  );

  Widget _officeLinks(BuildContext context) => FiberPanel(
    padding: EdgeInsets.zero,
    child: Column(
      children: [
        _officeLink(
          context,
          'Bandwidth accounting',
          Icons.wifi_rounded,
          WorkspaceSection.bandwidth,
        ),
        const Divider(indent: 56, endIndent: 17),
        _officeLink(
          context,
          'Company expenses',
          Icons.receipt_long_outlined,
          WorkspaceSection.expenses,
        ),
        const Divider(indent: 56, endIndent: 17),
        _officeLink(
          context,
          'Reports',
          Icons.bar_chart_rounded,
          WorkspaceSection.reports,
        ),
      ],
    ),
  );

  Widget _officeLink(
    BuildContext context,
    String title,
    IconData icon,
    WorkspaceSection section,
  ) => ListTile(
    leading: Icon(icon, color: Theme.of(context).colorScheme.primary),
    title: Text(title),
    subtitle: widget.onOpenSection == null
        ? const Text('Available on desktop')
        : null,
    trailing: widget.onOpenSection == null
        ? const Icon(Icons.desktop_windows_outlined, size: 18)
        : const Icon(Icons.chevron_right_rounded),
    onTap: widget.onOpenSection == null
        ? null
        : () => widget.onOpenSection!(section),
  );

  Widget _personIcon(BuildContext context) => CircleAvatar(
    backgroundColor: Theme.of(context).colorScheme.primaryContainer,
    child: Icon(
      Icons.person_rounded,
      color: Theme.of(context).colorScheme.primary,
    ),
  );

  Future<void> _showDetails(
    BuildContext context,
    String title,
    List<(String, String)> fields,
  ) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (context) => SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          const Text('Recorded details · read only'),
          const SizedBox(height: 20),
          for (final field in fields) ...[
            Text(field.$1, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 5),
            SelectableText(field.$2),
            const SizedBox(height: 17),
          ],
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Done'),
            ),
          ),
        ],
      ),
    ),
  );
}

String _initials(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  return words.isEmpty
      ? 'FN'
      : words
            .take(2)
            .map((word) => String.fromCharCode(word.runes.first))
            .join()
            .toUpperCase();
}

String _statusLabel(ActivityStatus status) => switch (status) {
  ActivityStatus.completed => 'Recorded',
  ActivityStatus.pending => 'Pending',
  ActivityStatus.refunded => 'Refunded',
  ActivityStatus.failed => 'Failed',
};
