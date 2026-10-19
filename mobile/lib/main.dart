import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'application/controller.dart';
import 'application/sample_data.dart';
import 'ui/fiber_ui.dart' as ui;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FiberMobileApp());
}

/// Temporary HTTP is never available to web, iPhone or release builds.
Uri? temporaryHttpEndpointForPlatform({
  required bool debugMode,
  required bool isWeb,
  required TargetPlatform platform,
  required String configuredEndpoint,
}) {
  if (!debugMode || isWeb || platform != TargetPlatform.android) return null;
  return ui.canonicalTemporaryHttpEndpoint(configuredEndpoint);
}

class FiberMobileApp extends StatefulWidget {
  const FiberMobileApp({super.key, this.controller});

  final FiberAppController? controller;

  @override
  State<FiberMobileApp> createState() => _FiberMobileAppState();
}

class _FiberMobileAppState extends State<FiberMobileApp>
    with WidgetsBindingObserver {
  final _navigator = GlobalKey<NavigatorState>();
  late final FiberAppController _controller;
  late final Uri? _temporaryHttpEndpoint;
  ui.AppRole? _previewRole;
  String _previewBusiness = 'all';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _temporaryHttpEndpoint = temporaryHttpEndpointForPlatform(
      debugMode: kDebugMode,
      isWeb: kIsWeb,
      platform: defaultTargetPlatform,
      configuredEndpoint: const String.fromEnvironment(
        'TEMPORARY_HTTP_ENDPOINT',
      ),
    );
    _controller =
        widget.controller ??
        FiberAppController(
          temporaryHttpEndpoint: _temporaryHttpEndpoint,
          allowInsecureLoopback:
              kDebugMode &&
              const bool.fromEnvironment('ALLOW_LOOPBACK_FIXTURE'),
        );
    // A separate, clearly labelled design mode. It never constructs a client.
    if (const bool.fromEnvironment('DESIGN_PREVIEW')) {
      const role = String.fromEnvironment(
        'PREVIEW_ROLE',
        defaultValue: 'admin',
      );
      _previewRole = switch (role) {
        'cashier' => ui.AppRole.cashier,
        'support' => ui.AppRole.support,
        _ => ui.AppRole.admin,
      };
      _previewBusiness = _previewRole == ui.AppRole.admin
          ? 'all'
          : 'fiber-resellers';
      const screen = String.fromEnvironment(
        'PREVIEW_SCREEN',
        defaultValue: 'dashboard',
      );
      if (screen != 'dashboard') {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _showRenewalPreview(screen);
        });
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _previewRole == null &&
        _controller.isSignedIn) {
      unawaited(_controller.refresh());
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: _navigator,
    title: 'FIBER net lb',
    debugShowCheckedModeBanner: false,
    theme: ui.FiberTheme.light,
    darkTheme: ui.FiberTheme.dark,
    themeMode: ThemeMode.light,
    home: AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final previewRole = _previewRole;
        if (previewRole != null) {
          return ui.FiberWorkspacePage(
            key: ValueKey('preview-${previewRole.name}'),
            viewModel: SampleData.workspace(previewRole, _previewBusiness),
            onBusinessChanged: (value) =>
                setState(() => _previewBusiness = value),
            onRefresh: () async {},
            onSignOut: () => setState(() => _previewRole = null),
            onCustomerSelected: (_) => _showRenewalPreview('review'),
            onOpenSection: (_) => _choosePreview(context),
          );
        }
        final model = _controller.viewModel;
        if (_controller.isSignedIn && model != null) {
          return ui.FiberWorkspacePage(
            key: ValueKey('live-${model.username}'),
            viewModel: model,
            onBusinessChanged: (value) =>
                unawaited(_controller.selectBusiness(value)),
            onRefresh: _controller.refresh,
            onSignOut: () => unawaited(_controller.signOut()),
            onCustomerSearch: (value) =>
                unawaited(_controller.searchCustomers(value)),
          );
        }
        return ui.FiberSignInPage(
          busy: _controller.busy,
          error: _controller.error,
          initialEndpoint:
              _controller.endpoint?.toString() ??
              _temporaryHttpEndpoint?.toString() ??
              '',
          temporaryHttpEndpoint: _temporaryHttpEndpoint?.toString(),
          onSubmit: (input) => unawaited(
            _controller.signIn(
              input,
              allowTemporaryHttp: input.allowTemporaryHttp,
            ),
          ),
          onOpenPreview: () => _choosePreview(context),
        );
      },
    ),
  );

  Future<void> _choosePreview(BuildContext context) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          children: [
            Text(
              'Explore the design',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 6),
            const Text(
              'Sample data only. No server connection or real transaction.',
            ),
            const SizedBox(height: 12),
            for (final entry in const {
              'admin': 'Admin dashboard',
              'cashier': 'Cashier dashboard',
              'support': 'Support dashboard',
              'review': 'Renewal review',
              'success': 'Successful renewal',
              'incomplete': 'Incomplete renewal',
            }.entries)
              ListTile(
                leading: Icon(
                  entry.key == 'admin'
                      ? Icons.admin_panel_settings_outlined
                      : entry.key == 'cashier' || entry.key == 'support'
                      ? Icons.person_outline
                      : Icons.description_outlined,
                ),
                title: Text(entry.value),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.pop(context, entry.key),
              ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'admin' || choice == 'cashier' || choice == 'support') {
      setState(() {
        _previewRole = ui.AppRole.values.byName(choice);
        _previewBusiness = choice == 'admin' ? 'all' : 'fiber-resellers';
      });
    } else {
      _showRenewalPreview(choice);
    }
  }

  void _showRenewalPreview(String screen) {
    final navigator = _navigator.currentState;
    if (navigator == null) return;
    navigator.push<void>(
      MaterialPageRoute<void>(
        builder: (context) => screen == 'review'
            ? ui.FiberRenewalReviewPage(
                model: SampleData.renewal,
                onBack: () => Navigator.pop(context),
              )
            : ui.FiberRenewalResultPage(
                model: ui.RenewalResultViewModel(
                  review: SampleData.renewal,
                  outcome: screen == 'success'
                      ? ui.RenewalOutcome.completed
                      : ui.RenewalOutcome.incomplete,
                  message: screen == 'success'
                      ? 'Sample success screen. No real renewal was submitted.'
                      : 'Sample incomplete screen. The outcome needs verification; do not submit again blindly.',
                  receiptId: screen == 'success' ? 'DEMO-0042' : null,
                ),
                onBackToCustomers: () => Navigator.pop(context),
              ),
      ),
    );
  }
}
