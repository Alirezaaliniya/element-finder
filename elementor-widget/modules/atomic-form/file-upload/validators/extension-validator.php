<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload\Validators;

use ElementorPro\Modules\AtomicForm\File_Upload\Form_File;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Extension_Validator implements Validator {

	/**
	 * Executable / script extensions rejected unconditionally — overrides any user allow-list.
	 * Ported from V3 Forms `Upload::get_blacklist_file_ext()`.
	 */
	public const BLACKLIST = [
		'php',
		'php2',
		'php3',
		'php4',
		'php5',
		'php6',
		'php7',
		'phps',
		'pht',
		'phtm',
		'phtml',
		'phar',
		'hphp',
		'phpt',
		'shtml',
		'asp',
		'aspx',
		'jsp',
		'cgi',
		'pl',
		'py',
		'rb',
		'sh',
		'bash',
		'csh',
		'cmd',
		'bat',
		'ps1',
		'ps2',
		'exe',
		'com',
		'jar',
		'lnk',
		'tmp',
		'htm',
		'html',
		'js',
		'htaccess',
		'htpasswd',
		'svg',
		'svgz',
		'swf',
		'hta',
	];

	private array $allowed;

	public function __construct( string $allowed_raw ) {
		$this->allowed = $this->normalize( $allowed_raw );
	}

	/**
	 * @param Form_File[] $files
	 */
	public function validate( array $files ): ?string {
		foreach ( $files as $file ) {
			$error = $this->validate_one( $file );
			if ( null !== $error ) {
				return $error;
			}
		}

		return null;
	}

	private function validate_one( Form_File $file ): ?string {
		$ext = strtolower( pathinfo( $file->name, PATHINFO_EXTENSION ) );

		if ( in_array( $ext, self::BLACKLIST, true ) ) {
			return __( 'This file type is not allowed for security reasons.', 'elementor-pro' );
		}

		if ( ! empty( $this->allowed ) && ! in_array( $ext, $this->allowed, true ) ) {
			return __( 'This file type is not allowed.', 'elementor-pro' );
		}

		return null;
	}

	private function normalize( string $raw ): array {
		if ( '' === trim( $raw ) ) {
			return [];
		}

		$flattened = [];

		foreach ( explode( ',', $raw ) as $piece ) {
			$piece = strtolower( trim( ltrim( $piece, '.' ) ) );
			if ( '' !== $piece ) {
				$flattened[] = $piece;
			}
		}

		return array_values( array_unique( $flattened ) );
	}
}
