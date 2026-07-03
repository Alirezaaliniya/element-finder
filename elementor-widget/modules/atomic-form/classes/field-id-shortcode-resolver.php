<?php
namespace ElementorPro\Modules\AtomicForm\Classes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Field_Id_Shortcode_Resolver implements Shortcode_Resolver {
	private array $form_data;

	public function __construct( array $form_data ) {
		$this->form_data = $form_data;
	}

	public function resolve( string $message ): string {
		return preg_replace_callback(
			'/\[field[^\]]*id=["\']([^"\']+)["\'][^\]]*\]/',
			function ( $matches ) {
				$field_id = $matches[1];

				if ( isset( $this->form_data[ $field_id ] ) ) {
					$value = $this->form_data[ $field_id ];

					return is_array( $value ) ? implode( ', ', $value ) : $value;
				}

				return '';
			},
			$message
		);
	}
}
