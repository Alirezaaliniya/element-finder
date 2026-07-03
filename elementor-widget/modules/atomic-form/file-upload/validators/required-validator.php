<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload\Validators;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Required_Validator implements Validator {

	private bool $required;

	public function __construct( bool $required ) {
		$this->required = $required;
	}

	public function validate( array $files ): ?string {
		if ( $this->required && empty( $files ) ) {
			return __( 'This field is required.', 'elementor-pro' );
		}

		return null;
	}
}
