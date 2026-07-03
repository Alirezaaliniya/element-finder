<?php
namespace ElementorPro\Modules\AtomicForm\Classes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Cssid_Shortcode_Resolver implements Shortcode_Resolver {
	private array $form_data;
	private bool $is_html;
	private array $cssid_map;

	public function __construct( array $form_data, bool $is_html, array $cssid_map ) {
		$this->form_data = $form_data;
		$this->is_html = $is_html;
		$this->cssid_map = $cssid_map;
	}

	public function resolve( string $message ): string {
		foreach ( $this->cssid_map as $cssid => $element_id ) {
			$shortcode = '[' . $cssid . ']';

			if ( All_Fields_Shortcode_Resolver::SHORTCODE === $shortcode ) {
				continue;
			}

			if ( strpos( $message, $shortcode ) === false ) {
				continue;
			}

			if ( isset( $this->form_data[ $element_id ] ) ) {
				$value = $this->form_data[ $element_id ];

				if ( $this->is_html && is_string( $value ) ) {
					$value = nl2br( esc_html( $value ) );
				}

				$replacement = is_array( $value ) ? implode( ', ', $value ) : $value;
			} else {
				$replacement = '';
			}

			$message = str_replace( $shortcode, $replacement, $message );
		}

		return $message;
	}
}
