<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Form_File {

	public string $name;
	public string $type;
	public string $tmp_name;
	public int $error;
	public int $size;

	public function __construct( string $name, string $type, string $tmp_name, int $error, int $size ) {
		$this->name = $name;
		$this->type = $type;
		$this->tmp_name = $tmp_name;
		$this->error = $error;
		$this->size = $size;
	}

	public function to_wp_handle_upload_array(): array {
		return [
			'name'     => $this->name,
			'type'     => $this->type,
			'tmp_name' => $this->tmp_name,
			'error'    => $this->error,
			'size'     => $this->size,
		];
	}
}
