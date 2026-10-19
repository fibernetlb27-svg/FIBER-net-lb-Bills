import 'package:flutter/material.dart';

import 'models.dart';
import 'shared.dart';

class FiberSignInPage extends StatefulWidget {
  const FiberSignInPage({
    super.key,
    required this.onSubmit,
    this.initialEndpoint = '',
    this.busy = false,
    this.error,
    this.onOpenPreview,
    this.temporaryHttpEndpoint,
  });

  final ValueChanged<SignInInput> onSubmit;
  final String initialEndpoint;
  final bool busy;
  final String? error;
  final VoidCallback? onOpenPreview;
  final String? temporaryHttpEndpoint;

  @override
  State<FiberSignInPage> createState() => _FiberSignInPageState();
}

class _FiberSignInPageState extends State<FiberSignInPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _endpoint;
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _showPassword = false;
  bool _temporaryHttpConsent = false;

  bool get _usesTemporaryHttp => matchesTemporaryHttpEndpoint(
    _endpoint.text,
    widget.temporaryHttpEndpoint,
  );

  @override
  void initState() {
    super.initState();
    _endpoint = TextEditingController(text: widget.initialEndpoint);
    _endpoint.addListener(_endpointChanged);
  }

  void _endpointChanged() {
    setState(() => _temporaryHttpConsent = false);
  }

  @override
  void didUpdateWidget(covariant FiberSignInPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.temporaryHttpEndpoint != widget.temporaryHttpEndpoint) {
      _temporaryHttpConsent = false;
    }
  }

  @override
  void dispose() {
    _endpoint.removeListener(_endpointChanged);
    _endpoint.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (widget.busy || !(_formKey.currentState?.validate() ?? false)) return;
    if (_usesTemporaryHttp && !_temporaryHttpConsent) return;
    final allowTemporaryHttp = _usesTemporaryHttp && _temporaryHttpConsent;
    setState(() => _temporaryHttpConsent = false);
    FocusScope.of(context).unfocus();
    widget.onSubmit(
      SignInInput(
        endpoint: _endpoint.text.trim(),
        username: _username.text.trim(),
        password: _password.text,
        allowTemporaryHttp: allowTemporaryHttp,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 470),
            child: AutofillGroup(
              onDisposeAction: AutofillContextAction.cancel,
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const FiberBrand(),
                    const SizedBox(height: 38),
                    Text(
                      'Your business.\nConnected.',
                      style: Theme.of(context).textTheme.headlineLarge,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Sign in with your staff account to view '
                      'your FIBER net lb workspace.',
                      style: Theme.of(context).textTheme.bodyLarge
                          ?.copyWith(height: 1.5),
                    ),
                    const SizedBox(height: 26),
                    if (widget.error != null) ...[
                      FiberMessage(
                        key: const Key('sign-in-error'),
                        title: 'Unable to sign in',
                        message: widget.error!,
                        icon: Icons.lock_outline_rounded,
                        isError: true,
                      ),
                      const SizedBox(height: 20),
                    ],
                    TextFormField(
                      key: const Key('server-endpoint'),
                      controller: _endpoint,
                      enabled: !widget.busy,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        labelText: 'Server address',
                        hintText: 'https://your-company-server',
                        prefixIcon: const Icon(Icons.dns_outlined),
                        helperText: _usesTemporaryHttp
                            ? 'Temporary Android test address. HTTPS is required for regular use.'
                            : 'Use the secure address provided by your Admin.',
                        helperMaxLines: 3,
                      ),
                      validator: (value) {
                        final endpoint = Uri.tryParse(value?.trim() ?? '');
                        if (_usesTemporaryHttp) return null;
                        if (endpoint == null ||
                            endpoint.scheme != 'https' ||
                            !endpoint.hasAuthority ||
                            endpoint.host.isEmpty ||
                            endpoint.userInfo.isNotEmpty ||
                            endpoint.hasQuery ||
                            endpoint.hasFragment) {
                          return 'Enter a valid HTTPS server address.';
                        }
                        return null;
                      },
                    ),
                    if (_usesTemporaryHttp) ...[
                      const SizedBox(height: 16),
                      const FiberMessage(
                        key: Key('temporary-http-sign-in-warning'),
                        title: 'Temporary HTTP test · Not encrypted',
                        message:
                            'Your password, session and customer or financial '
                            'information could be read or changed by someone on '
                            'the network. Use a trusted connection only and ask '
                            'your Admin for HTTPS before regular use. This test '
                            'build remains view-only.',
                        icon: Icons.lock_open_rounded,
                        isError: true,
                      ),
                      const SizedBox(height: 8),
                      Material(
                        color: Colors.transparent,
                        child: CheckboxListTile(
                          key: const Key('temporary-http-consent'),
                          value: _temporaryHttpConsent,
                          onChanged: widget.busy
                              ? null
                              : (value) => setState(() {
                                  _temporaryHttpConsent = value ?? false;
                                }),
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          title: const Text(
                            'I understand the unencrypted '
                            'connection risk and consent for this login.',
                          ),
                          subtitle: const Text(
                            'Required again for each login attempt.',
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    TextFormField(
                      key: const Key('sign-in-username'),
                      controller: _username,
                      enabled: !widget.busy,
                      autofillHints: const [AutofillHints.username],
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        prefixIcon: Icon(Icons.person_outline_rounded),
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? 'Enter your username.'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      key: const Key('sign-in-password'),
                      controller: _password,
                      enabled: !widget.busy,
                      autofillHints: const [AutofillHints.password],
                      obscureText: !_showPassword,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        suffixIcon: IconButton(
                          tooltip: _showPassword
                              ? 'Hide password'
                              : 'Show password',
                          onPressed: widget.busy
                              ? null
                              : () => setState(
                                  () => _showPassword = !_showPassword,
                                ),
                          icon: Icon(
                            _showPassword
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                          ),
                        ),
                      ),
                      validator: (value) => value == null || value.isEmpty
                          ? 'Enter your password.'
                          : null,
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        key: const Key('sign-in-submit'),
                        onPressed:
                            widget.busy ||
                                (_usesTemporaryHttp && !_temporaryHttpConsent)
                            ? null
                            : _submit,
                        icon: widget.busy
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.arrow_forward_rounded),
                        label: Text(
                          widget.busy
                              ? _usesTemporaryHttp
                                    ? 'Connecting…'
                                    : 'Connecting securely…'
                              : _usesTemporaryHttp
                              ? 'Sign in over HTTP (test)'
                              : 'Sign in',
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Your desktop and mobile app use the same company records. '
                      'No password or customer records are saved on this device.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall
                          ?.copyWith(height: 1.6),
                    ),
                    if (widget.onOpenPreview != null) ...[
                      const SizedBox(height: 20),
                      Center(
                        child: TextButton.icon(
                          key: const Key('open-preview'),
                          onPressed: widget.busy ? null : widget.onOpenPreview,
                          icon: const Icon(Icons.auto_awesome_outlined),
                          label: const Text('Explore the design preview'),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
