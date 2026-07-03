<?php
namespace ElementorPro\Modules\AtomicForm\Actions;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Webhook_Action extends Action_Base {

	public function get_type(): string {
		return Action_Type::WEBHOOK;
	}

	public function execute( array $form_data, array $widget_settings, array $context ): array {
		$url = isset( $widget_settings['webhook_url'] ) ? trim( $widget_settings['webhook_url'] ) : '';
		if ( '' === $url || ! wp_http_validate_url( $url ) ) {
			return $this->failure( __( 'Webhook URL is required and must be valid', 'elementor-pro' ) );
		}

		if ( ! isset( $context['form_id'], $context['form_name'], $context['post_id'], $context['field_metadata'] ) || ! is_array( $context['field_metadata'] ) ) {
			return $this->failure( __( 'Webhook requires form context (form id, form name, post id, field metadata).', 'elementor-pro' ) );
		}

		$field_metadata = $context['field_metadata'];
		$used_keys = array_fill_keys(
			[ 'form_id', 'form_name', 'post_id', 'site_url', 'timestamp' ],
			true
		);
		$body = [];
		foreach ( $form_data as $field_id => $value ) {
			$display_key = $this->resolve_webhook_field_key( $field_id, $field_metadata );
			$body_key = $this->ensure_unique_webhook_body_key( $display_key, $field_id, $used_keys );
			$body[ $body_key ] = $value;
		}

		$body['form_id'] = $context['form_id'];
		$body['form_name'] = $context['form_name'];
		$body['post_id'] = $context['post_id'];
		$body['site_url'] = get_site_url();
		$body['timestamp'] = current_time( 'mysql' );

		$args = [
			'body' => $body,
			'headers' => [
				'User-Agent' => 'Elementor Pro Atomic Forms/' . ELEMENTOR_PRO_VERSION,
			],
		];

		$args = apply_filters(
			'elementor_pro/atomic_forms/webhooks/request_args',
			$args,
			$form_data,
			$widget_settings,
			$context
		);

		$response = wp_safe_remote_post( $url, $args );

		if ( is_wp_error( $response ) ) {
			return $this->failure(
				sprintf(
					/* translators: %s: Error message. */
					__( 'Webhook request failed: %s', 'elementor-pro' ),
					$response->get_error_message()
				)
			);
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );

		if ( $response_code >= 200 && $response_code < 300 ) {
			return $this->success(
				__( 'Webhook delivered successfully', 'elementor-pro' ),
				[
					'responseCode' => $response_code,
					'responseBody' => $response_body,
				]
			);
		}

		return $this->failure(
			sprintf(
				/* translators: %d: HTTP status code. */
				__( 'Webhook returned error status code: %d', 'elementor-pro' ),
				$response_code
			),
			[
				'responseCode' => $response_code,
				'responseBody' => $response_body,
			]
		);
	}

	private function resolve_webhook_field_key( $field_id, array $field_metadata ): string {
		$meta = $field_metadata[ $field_id ] ?? [];
		$label = isset( $meta['label'] ) ? trim( $meta['label'] ) : '';

		if ( '' !== $label ) {
			return $label;
		}

		return (string) $field_id;
	}

	private function ensure_unique_webhook_body_key( string $display_key, $field_id, array &$used_keys ): string {
		if ( ! isset( $used_keys[ $display_key ] ) ) {
			$used_keys[ $display_key ] = true;

			return $display_key;
		}

		$fallback = $display_key . '_' . $field_id;

		if ( ! isset( $used_keys[ $fallback ] ) ) {
			$used_keys[ $fallback ] = true;

			return $fallback;
		}

		$field_id_key = (string) $field_id;
		$used_keys[ $field_id_key ] = true;

		return $field_id_key;
	}
}
