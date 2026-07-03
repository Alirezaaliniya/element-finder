<?php
namespace ElementorPro\Modules\AtomicForm\Classes;

use Elementor\Modules\AtomicWidgets\Controls\Section;
use Elementor\Modules\AtomicWidgets\Controls\Types\Switch_Control;
use Elementor\Modules\AtomicWidgets\Elements\Atomic_Form\Atomic_Form;
use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\Boolean_Prop_Type;
use ElementorPro\Core\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Akismet {

	public function __construct() {
		add_filter( 'elementor/atomic-widgets/props-schema', [ $this, 'register_props' ] );
		add_filter( 'elementor/atomic-widgets/controls', [ $this, 'register_controls' ], 10, 2 );
		add_filter( 'elementor_pro/atomic_forms/spam_check', [ $this, 'is_spam' ], 10, 4 );
	}

	public function register_props( array $schema ): array {
		if ( ! isset( $schema['actions-after-submit'] ) ) {
			return $schema;
		}

		if ( ! $this->is_akismet_active() ) {
			return $schema;
		}

		$schema['akismet-enabled'] = Boolean_Prop_Type::make()->default( false );

		return $schema;
	}

	public function register_controls( array $controls, $element ): array {
		if ( ! ( $element instanceof Atomic_Form ) ) {
			return $controls;
		}

		if ( ! $this->is_akismet_active() ) {
			return $controls;
		}

		$controls[] = Section::make()
			->set_label( __( 'Akismet', 'elementor-pro' ) )
			->set_items( [
				Switch_Control::bind_to( 'akismet-enabled' )
					->set_label( __( 'Akismet spam protection', 'elementor-pro' ) ),
			] );

		return $controls;
	}

	public function is_akismet_active(): bool {
		if ( ! class_exists( '\Akismet' ) ) {
			return false;
		}

		$akismet_key = \Akismet::get_api_key();

		return ! empty( $akismet_key );
	}

	public function is_spam( bool $is_spam, array $form_fields, array $widget_settings, int $post_id = 0 ): bool {
		if ( $is_spam ) {
			return true;
		}

		if ( empty( $widget_settings['akismet-enabled'] ) ) {
			return false;
		}

		if ( ! $this->is_akismet_active() ) {
			return false;
		}

		$mapped = $this->map_fields( $form_fields );
		$params = $this->build_params( $mapped, $post_id );

		return $this->remote_check_is_spam( $params );
	}

	private function map_fields( array $form_fields ): array {
		$mapped = [
			'comment_author'       => '',
			'comment_author_email' => '',
			'comment_author_url'   => '',
			'comment_content'      => '',
		];

		$text_fields = [];
		$textarea_fields = [];

		foreach ( $form_fields as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}

			$type  = sanitize_text_field( $field['type'] ?? 'text' );
			$value = sanitize_text_field( $field['value'] ?? '' );
			$label = sanitize_text_field( $field['label'] ?? '' );

			switch ( $type ) {
				case 'email':
					if ( empty( $mapped['comment_author_email'] ) ) {
						$mapped['comment_author_email'] = $value;
					}
					break;

				case 'url':
					if ( empty( $mapped['comment_author_url'] ) ) {
						$mapped['comment_author_url'] = $value;
					}
					break;

				case 'textarea':
					$textarea_fields[] = [
						'label' => $label,
						'value' => sanitize_textarea_field( $field['value'] ?? '' ),
					];
					break;

				case 'text':
					$text_fields[] = [
						'label' => $label,
						'value' => $value,
					];
					break;
			}
		}

		$mapped['comment_author'] = $this->concatenate_fields( $text_fields );
		$mapped['comment_content'] = $this->concatenate_fields( $textarea_fields );

		return $mapped;
	}

	private function concatenate_fields( array $fields ): string {
		if ( empty( $fields ) ) {
			return '';
		}

		if ( 1 === count( $fields ) ) {
			return $fields[0]['value'];
		}

		$parts = [];
		foreach ( $fields as $field ) {
			$label = ! empty( $field['label'] ) ? $field['label'] : 'Field';
			$parts[] = $label . ': ' . $field['value'];
		}

		return implode( ' | ', $parts );
	}

	private function build_params( array $mapped, int $post_id = 0 ): array {
		$params = $mapped;

		$params['blog']         = get_option( 'home' );
		$params['blog_lang']    = get_locale();
		$params['blog_charset'] = get_option( 'blog_charset' );

		if ( $post_id ) {
			$params['permalink'] = get_permalink( $post_id );
		}

		$params['user_ip']  = Utils::get_client_ip();
		$params['referrer'] = wp_get_referer();

		if ( ! empty( $_SERVER['HTTP_USER_AGENT'] ) ) {
			$params['user_agent'] = sanitize_textarea_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) );
		}

		$params['comment_type'] = 'contact-form';

		$ignore = [ 'HTTP_COOKIE', 'HTTP_COOKIE2', 'PHP_AUTH_PW' ];
		foreach ( $_SERVER as $key => $value ) {
			if ( ! in_array( $key, $ignore, true ) && is_string( $value ) ) {
				$params[ $key ] = sanitize_text_field( wp_unslash( $value ) );
			}
		}

		return $params;
	}

	private function remote_check_is_spam( array $params ): bool {
		$response = \Akismet::http_post( _http_build_query( $params, '', '&' ), 'comment-check' );

		return 'true' === $response[1];
	}
}
