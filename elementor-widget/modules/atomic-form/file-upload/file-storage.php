<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class File_Storage {

	private const UPLOAD_SUBDIR = '/elementor/forms';

	public function store( Form_File $file ): array {
		if ( UPLOAD_ERR_OK !== $file->error ) {
			return [ 'error' => $this->translate_php_upload_error( $file->error ) ];
		}

		return $this->move( $file );
	}

	public function delete( array $paths ): void {
		foreach ( $paths as $path ) {
			if ( file_exists( $path ) ) {
				@unlink( $path );
			}
		}
	}

	/**
	 * Run wp_handle_upload with the upload_dir filter scoped to /uploads/elementor/forms/.
	 *
	 * @return array{path: string, url: string} | array{error: string}
	 */
	private function move( Form_File $file ): array {
		$this->ensure_upload_dir();

		$filter = function ( $uploads ) {
			$base_path = trailingslashit( $uploads['basedir'] ) . ltrim( self::UPLOAD_SUBDIR, '/' );
			$base_url  = trailingslashit( $uploads['baseurl'] ) . ltrim( self::UPLOAD_SUBDIR, '/' );

			$uploads['path']   = $base_path;
			$uploads['url']    = $base_url;
			$uploads['subdir'] = self::UPLOAD_SUBDIR;
			$uploads['error']  = false;

			return $uploads;
		};

		add_filter( 'upload_dir', $filter );

		try {
			$file_array = $file->to_wp_handle_upload_array();
			$result = wp_handle_upload(
				$file_array,
				[ 'action' => 'elementor_pro_atomic_forms_send_form' ]
			);
		} finally {
			remove_filter( 'upload_dir', $filter );
		}

		if ( ! is_array( $result ) || isset( $result['error'] ) ) {
			$message = is_array( $result ) && isset( $result['error'] )
				? (string) $result['error']
				: __( 'Could not upload the file.', 'elementor-pro' );

			return [ 'error' => $message ];
		}

		return [
			'path' => (string) $result['file'],
			'url'  => (string) $result['url'],
		];
	}

	/**
	 * Ported from V3 Forms `Upload::get_ensure_upload_dir()` (`modules/forms/fields/upload.php:436`).
	 */
	private function ensure_upload_dir(): void {
		$uploads = wp_upload_dir( null, false );
		$path = trailingslashit( $uploads['basedir'] ) . ltrim( self::UPLOAD_SUBDIR, '/' );

		if ( ! file_exists( $path ) ) {
			wp_mkdir_p( $path );
		}

		$index_file = trailingslashit( $path ) . 'index.php';
		if ( ! file_exists( $index_file ) ) {
			@file_put_contents( $index_file, "<?php\n// Silence is golden.\n" );
		}

		$htaccess = trailingslashit( $path ) . '.htaccess';
		if ( ! file_exists( $htaccess ) ) {
			@file_put_contents( $htaccess, "Options -Indexes\n<IfModule mod_headers.c>\n\tHeader set Content-Disposition attachment\n</IfModule>\n" );
		}
	}

	private function translate_php_upload_error( int $code ): string {
		switch ( $code ) {
			case UPLOAD_ERR_INI_SIZE:
			case UPLOAD_ERR_FORM_SIZE:
				return __( 'The uploaded file exceeds the allowed size.', 'elementor-pro' );
			case UPLOAD_ERR_PARTIAL:
				return __( 'The file was only partially uploaded.', 'elementor-pro' );
			case UPLOAD_ERR_NO_FILE:
				return __( 'No file was uploaded.', 'elementor-pro' );
			case UPLOAD_ERR_NO_TMP_DIR:
				return __( 'Server is missing a temporary folder for uploads.', 'elementor-pro' );
			case UPLOAD_ERR_CANT_WRITE:
				return __( 'Failed to write the file to disk.', 'elementor-pro' );
			case UPLOAD_ERR_EXTENSION:
				return __( 'A PHP extension stopped the upload.', 'elementor-pro' );
			default:
				return __( 'Unknown upload error.', 'elementor-pro' );
		}
	}
}
