<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload\Validators;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

interface Validator {
	public function validate( array $files ): ?string;
}
