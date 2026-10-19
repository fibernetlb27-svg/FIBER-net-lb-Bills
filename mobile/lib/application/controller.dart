import 'package:flutter/foundation.dart';

import '../core/fiber_api.dart' as core;
import '../ui/models.dart' as ui;

typedef FiberApiFactory = core.FiberApiClient Function(Uri endpoint);

/// Coordinates authenticated reads only. The desktop remains the sole ledger.
class FiberAppController extends ChangeNotifier {
  static const _unchanged = Object();
  FiberAppController({
    FiberApiFactory? apiFactory,
    bool allowInsecureLoopback = false,
    Uri? temporaryHttpEndpoint,
    bool temporaryHttpDebugEnabled = true,
  }) : _apiFactory =
           apiFactory ??
           ((endpoint) => core.FiberApiClient(
             server: endpoint,
             allowInsecureLoopback: allowInsecureLoopback,
             temporaryHttpEndpoint: temporaryHttpEndpoint,
             temporaryHttpDebugEnabled: temporaryHttpDebugEnabled,
           )),
       _temporaryHttpEndpoint = temporaryHttpEndpoint,
       _temporaryHttpDebugEnabled = temporaryHttpDebugEnabled,
       _allowInsecureLoopback = allowInsecureLoopback;

  final FiberApiFactory _apiFactory;
  final Uri? _temporaryHttpEndpoint;
  final bool _temporaryHttpDebugEnabled;
  final bool _allowInsecureLoopback;
  core.FiberApiClient? _api;
  Uri? _endpoint;
  ui.WorkspaceViewModel? _view;
  String? _error;
  bool _busy = false;
  bool _disposed = false;
  bool _mainAdmin = false;
  int _epoch = 0;
  int _searchEpoch = 0;

  bool get busy => _busy;
  String? get error => _error;
  Uri? get endpoint => _endpoint;
  bool get isSignedIn => !_disposed && _view != null && _api?.session != null;
  ui.WorkspaceViewModel? get viewModel => _view;

  void _publish() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int epoch, core.FiberApiClient api) =>
      !_disposed && epoch == _epoch && identical(api, _api);

  Future<void> signIn(
    ui.SignInInput input, {
    bool allowTemporaryHttp = false,
  }) async {
    if (_disposed || _busy || isSignedIn) return;
    final epoch = ++_epoch;
    _searchEpoch++;
    _busy = true;
    _view = null;
    _error = null;
    _mainAdmin = false;
    _api?.dispose();
    _api = null;
    _publish();
    core.FiberApiClient? api;
    try {
      final endpoint = Uri.tryParse(input.endpoint.trim());
      if (endpoint == null) {
        throw const core.FiberApiException(
          core.ApiFailure.configuration,
          'Enter the secure HTTPS server address supplied by your administrator.',
        );
      }
      final temporaryHttp = core.FiberApiClient.temporaryHttpAllowed(
        endpoint,
        _temporaryHttpEndpoint,
        debugEnabled: _temporaryHttpDebugEnabled,
      );
      if (endpoint.scheme == 'http') {
        final localTest =
            kDebugMode &&
            _allowInsecureLoopback &&
            const {'127.0.0.1', 'localhost', '::1'}.contains(endpoint.host);
        final origin = temporaryHttp
            ? 'http://${endpoint.host}:${endpoint.port}'
            : '';
        final exactText =
            input.endpoint.trim() == origin ||
            input.endpoint.trim() == '$origin/';
        if (!localTest && (!temporaryHttp || !exactText)) {
          throw const core.FiberApiException(
            core.ApiFailure.configuration,
            'HTTP is allowed only for the exact configured temporary Android test address. Use HTTPS for every other server.',
          );
        }
        if (temporaryHttp && !allowTemporaryHttp) {
          throw const core.FiberApiException(
            core.ApiFailure.configuration,
            'Confirm the temporary HTTP warning before this login. Your password and account data would travel without encryption.',
          );
        }
      }
      api = _apiFactory(endpoint);
      _api = api;
      final requestedServer = endpoint.replace(
        path: '${endpoint.path.replaceAll(RegExp(r'/+$'), '')}/',
      );
      if (api.server != requestedServer) {
        throw const core.FiberApiException(
          core.ApiFailure.configuration,
          'The client connection does not match the requested server address.',
        );
      }
      if (temporaryHttp && !api.usesTemporaryHttp) {
        throw const core.FiberApiException(
          core.ApiFailure.configuration,
          'The temporary HTTP client policy could not be verified.',
        );
      }
      _endpoint = api.server;
      await api.connect();
      if (!_current(epoch, api)) return;
      final session = await api.login(
        input.username,
        input.password,
        allowTemporaryHttp: allowTemporaryHttp,
      );
      if (!_current(epoch, api)) return;
      _role(session.user);
      _mainAdmin = session.user.isAdmin && session.workspaceId == 'main';
      final options = _businesses(session.user);
      final selected = _initialBusiness(options);
      _view = _base(session.user, selected, loading: true);
      _publish();
      await _load(api, epoch, selected);
    } catch (error) {
      if (api != null && _current(epoch, api)) {
        await _endSession(api, _safeError(error));
      } else if (!_disposed && epoch == _epoch) {
        _error = _safeError(error);
      }
    } finally {
      if (!_disposed && epoch == _epoch) {
        _busy = false;
        if (_view != null) _view = _copy(_view!, loading: false);
        _publish();
      }
    }
  }

  Future<void> refresh() async {
    final api = _api;
    final view = _view;
    if (_disposed || _busy || api == null || view == null) return;
    final epoch = ++_epoch;
    _searchEpoch++;
    _busy = true;
    _error = null;
    _view = _copy(view, loading: true, errorMessage: null);
    _publish();
    await _load(api, epoch, view.selectedBusinessId!);
    if (_current(epoch, api)) {
      _busy = false;
      if (_view != null) _view = _copy(_view!, loading: false);
      _publish();
    }
  }

  Future<void> selectBusiness(String id) async {
    final api = _api;
    final view = _view;
    if (_disposed || _busy || api?.session == null || view == null) return;
    if (id == view.selectedBusinessId) return;
    if (!view.businesses.any((business) => business.id == id)) {
      _error = 'Your account does not have access to that business.';
      _publish();
      return;
    }
    final epoch = ++_epoch;
    _searchEpoch++;
    _busy = true;
    _error = null;
    // Remove every previous business value before any asynchronous switch.
    _view = _base(api!.session!.user, id, loading: true);
    _publish();
    await _load(api, epoch, id);
    if (_current(epoch, api)) {
      _busy = false;
      if (_view != null) _view = _copy(_view!, loading: false);
      _publish();
    }
  }

  Future<void> _load(
    core.FiberApiClient api,
    int epoch,
    String selected,
  ) async {
    var target = selected;
    try {
      final originalSignature = _signature(api.session!.user);
      final user = await api.refreshSession();
      if (!_current(epoch, api)) return;
      if (user == null) {
        await _endSession(api, 'Your session ended. Please sign in again.');
        return;
      }
      _role(user);
      if (user.effectiveRole != 'admin') _mainAdmin = false;
      final options = _businesses(user);
      if (!options.any((option) => option.id == target)) {
        target = _initialBusiness(options);
      }
      if (_signature(user) != originalSignature || target != selected) {
        _view = _base(user, target, loading: true);
        _publish();
      }
      final sessionTarget = target == 'all' ? 'main' : target;
      if (api.session!.workspaceId != sessionTarget) {
        await api.switchWorkspace(sessionTarget);
        if (!_current(epoch, api)) return;
      }
      final finance = await api.financeOverview(workspaceId: target);
      if (!_current(epoch, api)) return;
      final freshUser = api.session!.user;
      final warnings = <String>[];
      if (finance.warning.isNotEmpty) {
        warnings.add('Older wallet custody needs review in the desktop app.');
      }
      var bills = <ui.ActivityItem>[];
      var resellers = <ui.ResellerItem>[];
      String? billsMessage;
      String? resellersMessage;
      if (freshUser.can('bills.view') &&
          const {'fiber-users', 'fiber-resellers', 'iptv'}.contains(target)) {
        final date = finance.today;
        if (_validDate(date)) {
          try {
            final rows = await api.bills(
              startDate: '${date.substring(0, 7)}-01',
              endDate: date,
            );
            if (!_current(epoch, api)) return;
            bills = rows.map(_bill).toList(growable: false);
          } catch (error) {
            if (!_current(epoch, api)) return;
            if (_authenticationLost(error, api)) {
              await _endSession(
                api,
                'Your session ended. Please sign in again.',
              );
              return;
            }
            billsMessage = _partialError('Bills', error);
            warnings.add(billsMessage);
          }
        } else {
          billsMessage = 'Bills are unavailable: the Main PC accounting date could not be verified.';
          warnings.add(billsMessage);
        }
      } else {
        billsMessage = freshUser.can('bills.view')
            ? 'Open Users, Resellers or IPTV to view that business’s bills.'
            : 'Your account does not have permission to view bills.';
      }
      if (target == 'fiber-resellers' &&
          freshUser.can('bills.view') &&
          const {'admin', 'cashier', 'support'}.contains(freshUser.role)) {
        try {
          final result = await api.resellerAccounts();
          if (!_current(epoch, api)) return;
          resellers = result.accounts
              .map(
                (row) => ui.ResellerItem(
                  id: row.username,
                  username: row.username,
                  name: row.name.isEmpty ? row.username : row.name,
                  balanceCents: _cents(row.balance),
                  moneyAddedCents: _cents(row.moneyAdded),
                  moneyCollectedCents: _cents(row.moneyCollected),
                  toCollectCents: _cents(row.toCollect),
                ),
              )
              .toList(growable: false);
        } catch (error) {
          if (!_current(epoch, api)) return;
          if (_authenticationLost(error, api)) {
            await _endSession(api, 'Your session ended. Please sign in again.');
            return;
          }
          resellersMessage = _partialError('Reseller balances', error);
          warnings.add(resellersMessage);
        }
      }
      if (!_current(epoch, api)) return;
      final receipts = finance.activity.map(_activity).toList(growable: false);
      final role = _role(freshUser);
      final now = DateTime.now();
      final synced =
          'Last synced ${_two(now.hour)}:${_two(now.minute)}'
          '${_validDate(finance.today) ? ' · server date ${finance.today}' : ''}';
      _view = ui.WorkspaceViewModel(
        employeeName: freshUser.fullName,
        username: freshUser.username,
        role: role,
        serverLabel: api.server.toString(),
        businesses: _businesses(freshUser),
        selectedBusinessId: target,
        temporaryHttpActive: api.usesTemporaryHttp,
        dashboard: _dashboard(finance),
        bills: bills,
        receipts: receipts,
        customers: const [],
        resellers: resellers,
        loading: false,
        hasLoadedData: true,
        lastSyncedLabel: synced,
        errorMessage: warnings.isEmpty ? null : warnings.join(' '),
        billsMessage: billsMessage,
        receiptsMessage: receipts.isEmpty
            ? 'No recent activity was returned by the Main PC for this scope.'
            : null,
        customersMessage: target == 'fiber-users'
            ? 'Search by name, username or phone. Enter at least 3 characters.'
            : 'Open FIBER net lb Users to search Internet customers.',
        resellersMessage: target == 'fiber-resellers'
            ? resellersMessage
            : 'Open FIBER net lb Resellers to view reseller balances.',
      );
      _error = _view!.errorMessage;
      _publish();
    } catch (error) {
      if (!_current(epoch, api)) return;
      if (_authenticationLost(error, api)) {
        await _endSession(api, 'Your session ended. Please sign in again.');
        return;
      }
      final prior = _view;
      final message = _safeError(error);
      if (_networkFailure(error) &&
          prior != null &&
          prior.selectedBusinessId == target &&
          prior.hasLoadedData) {
        _error =
            'Could not refresh. Showing the last verified data for this business. $message';
        _view = _copy(prior, loading: false, errorMessage: _error);
      } else {
        final current = api.session;
        if (current == null) {
          await _endSession(api, message);
          return;
        }
        if (!const {
              'admin',
              'cashier',
              'support',
            }.contains(current.user.effectiveRole) ||
            _businesses(current.user).isEmpty) {
          await _endSession(api, message);
          return;
        }
        _error = message;
        _view = _copy(
          _base(current.user, target),
          errorMessage: message,
          billsMessage:
              'Bills are unavailable until the connection is verified.',
          receiptsMessage:
              'Receipts are unavailable until the connection is verified.',
          customersMessage:
              'Customer data is unavailable until the connection is verified.',
          resellersMessage: 'Reseller balances are unavailable until the connection is verified.',
        );
      }
      _publish();
    }
  }

  Future<void> searchCustomers(String term) async {
    final api = _api;
    final prior = _view;
    if (_disposed ||
        _busy ||
        api == null ||
        prior == null ||
        prior.selectedBusinessId != 'fiber-users')
      return;
    final epoch = _epoch;
    final searchEpoch = ++_searchEpoch;
    final query = term.trim();
    _view = _copy(
      prior,
      customers: const [],
      customersMessage: query.length < 3
          ? 'Enter at least 3 characters to search Internet customers.'
          : 'Searching the Internet customer directory…',
    );
    _publish();
    if (query.length < 3) return;
    try {
      final result = await api.searchCustomers(query);
      if (!_current(epoch, api) || searchEpoch != _searchEpoch) return;
      final rows = result.customers
          .map(
            (row) => ui.CustomerItem(
              id: row.username,
              username: row.username,
              name: row.name.isEmpty ? row.username : row.name,
              planLabel: row.service,
              expiryLabel: row.expiry,
              statusLabel: row.blocked ? 'Blocked' : 'Not blocked',
            ),
          )
          .toList(growable: false);
      _view = _copy(
        _view!,
        customers: rows,
        customersMessage: rows.isEmpty
            ? 'No matching Internet customers were returned.'
            : null,
      );
      _publish();
    } catch (error) {
      if (!_current(epoch, api) || searchEpoch != _searchEpoch) return;
      if (_authenticationLost(error, api)) {
        await _endSession(api, 'Your session ended. Please sign in again.');
      } else {
        _view = _copy(
          _view!,
          customers: const [],
          customersMessage: _partialError('Customer search', error),
        );
        _publish();
      }
    }
  }

  Future<void> signOut() async {
    if (_disposed) return;
    final epoch = ++_epoch;
    _searchEpoch++;
    final api = _api;
    _api = null;
    _view = null;
    _mainAdmin = false;
    _busy = false;
    _error = null;
    _publish();
    if (api == null) return;
    final revoked = await api.logout();
    api.dispose();
    if (!_disposed && epoch == _epoch && !revoked) {
      _error = 'You are signed out on this phone. The Main PC could not be reached to end its session; its normal session expiry still applies.';
      _publish();
    }
  }

  Future<void> _endSession(core.FiberApiClient api, String message) async {
    _view = null;
    _mainAdmin = false;
    _busy = false;
    _error = message;
    _publish();
    await api.logout();
    api.dispose();
    if (identical(_api, api)) _api = null;
  }

  ui.AppRole _role(core.AppUser user) => switch (user.effectiveRole) {
    'admin' => ui.AppRole.admin,
    'cashier' => ui.AppRole.cashier,
    'support' => ui.AppRole.support,
    _ => throw const core.FiberApiException(
      core.ApiFailure.permission,
      'This mobile build supports Admin, Cashier and Support accounts. Use the desktop app for this account role.',
    ),
  };

  List<ui.BusinessOption> _businesses(core.AppUser user) => List.unmodifiable([
    if (_mainAdmin)
      const ui.BusinessOption(
        id: 'all',
        name: 'All businesses',
        kind: ui.BusinessKind.all,
      ),
    for (final workspace in core.Workspace.catalog)
      if (workspace.id == 'main'
          ? _mainAdmin || user.allowedSections.contains('main-expenses')
          : user.allowedSections.contains(workspace.id))
        ui.BusinessOption(
          id: workspace.id,
          name: workspace.id == 'main' ? 'Company expenses' : workspace.name,
          kind: switch (workspace.id) {
            'fiber-users' => ui.BusinessKind.users,
            'fiber-resellers' => ui.BusinessKind.resellers,
            _ => ui.BusinessKind.other,
          },
        ),
  ]);

  String _initialBusiness(List<ui.BusinessOption> options) {
    if (options.isEmpty) {
      throw const core.FiberApiException(
        core.ApiFailure.permission,
        'No supported business is assigned to this account. Ask your administrator to grant business access.',
      );
    }
    if (_mainAdmin) return 'all';
    return options
        .firstWhere((item) => item.id != 'main', orElse: () => options.first)
        .id;
  }

  ui.WorkspaceViewModel _base(
    core.AppUser user,
    String selected, {
    bool loading = false,
  }) => ui.WorkspaceViewModel(
    employeeName: user.fullName,
    username: user.username,
    role: _role(user),
    serverLabel: _endpoint.toString(),
    businesses: _businesses(user),
    selectedBusinessId: selected,
    temporaryHttpActive: _api?.usesTemporaryHttp ?? false,
    loading: loading,
  );

  ui.DashboardViewModel _dashboard(
    core.FinanceOverview finance,
  ) => ui.DashboardViewModel(
    revenueCents: _cents(finance.revenue),
    internetCostCents: _cents(finance.internetCost),
    cashCents: _cents(finance.cash),
    whishCents: _cents(finance.walletTotal),
    whishFeesCents: _cents(finance.whishFees),
    otherExpensesCents: _cents(finance.otherExpenses),
    netProfitBeforeOtherCents: _cents(finance.profitBeforeOther),
    netProfitAfterOtherCents: _cents(finance.profitAfterOther),
    bandwidthCostCents: _cents(finance.bandwidthCost),
    periodLabel: _validDate(finance.today)
        ? 'This month through ${finance.today} · ${finance.employeeName}'
        : 'Main PC accounting period unavailable',
    revenueHint: finance.admin && finance.workspaceId == 'fiber-resellers'
        ? 'Cash drawer + Whish wallets; server-calculated scope'
        : 'Recorded business income; internal transfers are not new income',
    netProfitHint: !finance.profitKnown
        ? 'Profit could not be verified. Review the desktop accounting status.'
        : finance.aggregate
        ? 'Sum of each business’s independently calculated profit.'
        : finance.workspaceId == 'fiber-resellers' && finance.admin
        ? 'Server-calculated profit includes bandwidth purchases once, including unpaid bills.'
        : 'Direct costs and Whish fees are deducted once by the Main PC.',
  );

  ui.ActivityItem _bill(core.BillReceipt bill) => ui.ActivityItem(
    id: 'bill-${bill.id ?? bill.receiptNo}',
    title: bill.receiptNo,
    description: [
      bill.customerName,
      bill.customerAccount,
      bill.bundleName,
    ].where((part) => part.isNotEmpty).join(' · '),
    amountCents: _cents(bill.amount),
    dateLabel: bill.paidAt,
    status: switch (bill.paymentStatus) {
      'paid' => ui.ActivityStatus.completed,
      'refunded' => ui.ActivityStatus.refunded,
      'failed' => ui.ActivityStatus.failed,
      _ => ui.ActivityStatus.pending,
    },
    paymentLabel: '${bill.paymentMethod} · ${bill.paymentStatus}',
    operatorName: bill.cashierName,
    renewalStatusLabel: !bill.serviceType.startsWith('Internet')
        ? null
        : switch (bill.renewalState) {
            'succeeded' => 'Renewal confirmed',
            'created' => 'Account creation confirmed',
            'free' => 'Free expiry update confirmed',
            'unknown' => 'Renewal outcome unknown — review required',
            'incomplete' => 'Renewal incomplete — review required',
            'failed' => 'Renewal failed',
            'processing' || 'checking' => 'Renewal still processing',
            'not_requested' => 'Payment only — not renewed',
            _ => 'Renewal status not supplied',
          },
    renewalMessage: bill.serviceType.startsWith('Internet')
        ? bill.renewalMessage
        : null,
  );

  ui.ActivityItem _activity(core.ActivityRecord row) => ui.ActivityItem(
    id: '${row.reference}-${row.createdAt}',
    title: row.reference.isEmpty ? row.title : row.reference,
    description: [
      row.title,
      row.customerName,
    ].where((part) => part.isNotEmpty).join(' · '),
    amountCents: _cents(row.amount),
    dateLabel: row.createdAt,
    status: ui.ActivityStatus.completed,
    paymentLabel: row.paymentMethod,
    operatorName: row.cashierName,
  );

  int? _cents(double? value) {
    final exact = core.usdAmount(value);
    return exact == null ? null : (exact * 100).round();
  }

  String _signature(core.AppUser user) {
    final permissions = user.permissions.toList()..sort();
    final sections = user.allowedSections.toList()..sort();
    return '${user.accountKey}|${user.role}|${user.sourceRole}|${permissions.join(',')}|${sections.join(',')}';
  }

  bool _authenticationLost(Object error, core.FiberApiClient api) =>
      api.session == null ||
      error is core.FiberApiException &&
          const {
            core.ApiFailure.authentication,
            core.ApiFailure.compatibility,
          }.contains(error.kind);

  bool _networkFailure(Object error) =>
      error is core.FiberApiException &&
      const {
        core.ApiFailure.connection,
        core.ApiFailure.timeout,
      }.contains(error.kind);

  String _safeError(Object error) => error is core.FiberApiException
      ? error.message
      : 'The server connection could not be verified. Try again or contact your administrator.';

  String _partialError(String subject, Object error) =>
      error is core.FiberApiException &&
          error.kind == core.ApiFailure.permission
      ? '$subject are unavailable for this account. No cached list was retained.'
      : '$subject could not be refreshed. No unverified list is shown.';

  bool _validDate(String value) =>
      RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) &&
      DateTime.tryParse(value)?.toIso8601String().startsWith(value) == true;
  String _two(int value) => value.toString().padLeft(2, '0');

  ui.WorkspaceViewModel _copy(
    ui.WorkspaceViewModel model, {
    bool? loading,
    Object? errorMessage = _unchanged,
    List<ui.CustomerItem>? customers,
    String? billsMessage,
    String? receiptsMessage,
    Object? customersMessage = _unchanged,
    String? resellersMessage,
  }) => ui.WorkspaceViewModel(
    employeeName: model.employeeName,
    username: model.username,
    role: model.role,
    serverLabel: model.serverLabel,
    businesses: model.businesses,
    selectedBusinessId: model.selectedBusinessId,
    dashboard: model.dashboard,
    bills: model.bills,
    receipts: model.receipts,
    customers: customers ?? model.customers,
    resellers: model.resellers,
    loading: loading ?? model.loading,
    errorMessage: identical(errorMessage, _unchanged)
        ? model.errorMessage
        : errorMessage as String?,
    lastSyncedLabel: model.lastSyncedLabel,
    hasLoadedData: model.hasLoadedData,
    temporaryHttpActive: model.temporaryHttpActive,
    employeeScopeLabel: model.employeeScopeLabel,
    billsMessage: billsMessage ?? model.billsMessage,
    receiptsMessage: receiptsMessage ?? model.receiptsMessage,
    customersMessage: identical(customersMessage, _unchanged)
        ? model.customersMessage
        : customersMessage as String?,
    resellersMessage: resellersMessage ?? model.resellersMessage,
  );

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _epoch++;
    _searchEpoch++;
    _api?.dispose();
    _api = null;
    _view = null;
    super.dispose();
  }
}
