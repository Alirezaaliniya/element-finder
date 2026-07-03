<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

final class File_Upload_Result {

	private bool $success;
	private string $error;
	private array $form_data_overrides;
	private array $files;
	private array $file_field_settings;

	private function __construct(
		bool $success,
		string $error,
		array $form_data_overrides,
		array $files,
		array $file_field_settings
	) {
		$this->success = $success;
		$this->error = $error;
		$this->form_data_overrides = $form_data_overrides;
		$this->files = $files;
		$this->file_field_settings = $file_field_settings;
	}

	/**
	 * @param array<string, mixed> $form_data_overrides Keyed by element_id.
	 * @param array<string, array<int, string>> $files Keyed by cssid.
	 * @param array<string, array> $file_field_settings Keyed by cssid.
	 */
	public static function success(
		array $form_data_overrides,
		array $files,
		array $file_field_settings
	): self {
		return new self( true, '', $form_data_overrides, $files, $file_field_settings );
	}

	public static function error( string $message ): self {
		return new self( false, $message, [], [], [] );
	}

	/**
	 * Empty success — used when the form has no file-upload widgets at all.
	 */
	public static function noop(): self {
		return new self( true, '', [], [], [] );
	}

	public function is_success(): bool {
		return $this->success;
	}

	public function get_error(): string {
		return $this->error;
	}

	public function get_form_data_overrides(): array {
		return $this->form_data_overrides;
	}

	public function get_files(): array {
		return $this->files;
	}

	public function get_file_field_settings(): array {
		return $this->file_field_settings;
	}
}
