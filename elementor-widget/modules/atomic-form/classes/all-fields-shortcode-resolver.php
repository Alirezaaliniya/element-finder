<?php
namespace ElementorPro\Modules\AtomicForm\Classes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class All_Fields_Shortcode_Resolver implements Shortcode_Resolver {
	public const SHORTCODE = '[all-fields]';

	private array $form_data;
	private bool $is_html;
	private array $field_metadata;

	public function __construct( array $form_data, bool $is_html, array $field_metadata ) {
		$this->form_data = $form_data;
		$this->is_html = $is_html;
		$this->field_metadata = $field_metadata;
	}

	public function resolve( string $message ): string {
		if ( strpos( $message, self::SHORTCODE ) === false ) {
			return $message;
		}

		$line_break = $this->is_html ? '<br>' : "\n";
		$all_fields_text = '';

		foreach ( $this->form_data as $key => $value ) {
			$meta = $this->field_metadata[ $key ] ?? [];
			$formatted_key = ! empty( $meta['label'] ) ? $meta['label'] : ucwords( str_replace( [ '_', '-' ], ' ', $key ) );
			$formatted_value = is_array( $value ) ? implode( ', ', $value ) : $value;

			if ( $this->is_html ) {
				$formatted_key = esc_html( $formatted_key );

				if ( is_string( $formatted_value ) ) {
					$formatted_value = nl2br( esc_html( $formatted_value ) );
				}
			}

			$all_fields_text .= sprintf(
				'%s: %s%s',
				$formatted_key,
				$formatted_value,
				$line_break
			);
		}

		return str_replace( self::SHORTCODE, $all_fields_text, $message );
	}
}
