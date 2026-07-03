<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload\Validators;

use ElementorPro\Modules\AtomicForm\File_Upload\Form_File;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Size_Validator implements Validator {

	private int $max_mb;

	public function __construct( int $max_mb ) {
		$this->max_mb = $max_mb;
	}

	/**
	 * @param Form_File[] $files
	 */
	public function validate( array $files ): ?string {
		$effective_max_bytes = min( $this->max_mb * 1024 * 1024, wp_max_upload_size() );

		foreach ( $files as $file ) {
			if ( $file->size > $effective_max_bytes ) {
				$max_mb_for_message = (int) ceil( $effective_max_bytes / ( 1024 * 1024 ) );

				return sprintf(
					/* translators: %d: maximum file size in megabytes. */
					__( 'File is too large. Maximum size is %d MB.', 'elementor-pro' ),
					$max_mb_for_message
				);
			}
		}

		return null;
	}
}
