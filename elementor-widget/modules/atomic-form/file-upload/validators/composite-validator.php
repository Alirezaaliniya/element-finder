<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload\Validators;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

final class Composite_Validator implements Validator {

	private array $validators;

	public function __construct( array $settings ) {
		$max_files = ! empty( $settings['multiple'] ) ? $settings['max-files'] : 1;

		$this->validators = [
			new Required_Validator( ! empty( $settings['required'] ) ),
			new Max_Count_Validator( $max_files ),
			new Extension_Validator( $settings['file-types'] ),
			new Size_Validator( $settings['max-file-size'] ),
		];
	}

	public function validate( array $files ): ?string {
		foreach ( $this->validators as $validator ) {
			$error = $validator->validate( $files );
			if ( null !== $error ) {
				return $error;
			}
		}

		return null;
	}
}
