<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

use ElementorPro\Modules\AtomicForm\File_Upload\Validators\Composite_Validator;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class File_Upload_Handler {

	public const MODE_LINK   = 'link';
	public const MODE_ATTACH = 'attach';
	public const MODE_BOTH   = 'both';

	private Field_Settings_Collector $field_settings_collector;
	private Form_File_Collector $form_file_collector;
	private File_Storage $storage;

	public function __construct() {
		$this->field_settings_collector = new Field_Settings_Collector();
		$this->form_file_collector = new Form_File_Collector();
		$this->storage = new File_Storage();
	}

	/**
	 * Validate, store, and produce form-data overrides for all file-upload widgets in a form.
	 *
	 * @param array $form_element The resolved form widget
	 * @param array $form_fields  The POSTed form_fields metadata
	 */
	public function process( array $form_element, array $form_fields ): File_Upload_Result {
		$field_settings = $this->field_settings_collector->collect( $form_element );

		if ( empty( $field_settings ) ) {
			return File_Upload_Result::noop();
		}

		$index_to_element_id = $this->build_index_to_element_id_map( $form_fields );
		$files_by_element_id = $this->form_file_collector->collect( $index_to_element_id );

		$form_data_overrides = [];
		$files               = [];
		$all_uploaded_paths  = [];

		foreach ( $field_settings as $element_id => $settings ) {
			$field_files = $files_by_element_id[ $element_id ] ?? [];

			$validation_error = ( new Composite_Validator( $settings ) )->validate( $field_files );
			if ( null !== $validation_error ) {
				return $this->fail( $validation_error, $all_uploaded_paths );
			}

			if ( empty( $field_files ) ) {
				continue;
			}

			$paths = [];
			$urls = [];

			foreach ( $field_files as $file ) {
				$upload = $this->storage->store( $file );

				if ( isset( $upload['error'] ) ) {
					return $this->fail( $upload['error'], $all_uploaded_paths );
				}

				$paths[]              = $upload['path'];
				$urls[]               = $upload['url'];
				$all_uploaded_paths[] = $upload['path'];
			}

			$files[ $element_id ] = $paths;
			$form_data_overrides[ $element_id ] = $urls;
		}

		return File_Upload_Result::success( $form_data_overrides, $files, $field_settings );
	}

	private function fail( string $message, array $uploaded_paths ): File_Upload_Result {
		$this->storage->delete( $uploaded_paths );

		return File_Upload_Result::error( $message );
	}

	private function build_index_to_element_id_map( array $form_fields ): array {
		$map = [];

		foreach ( $form_fields as $index => $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}

			$element_id = isset( $field['id'] ) ? sanitize_text_field( (string) $field['id'] ) : '';
			if ( '' === $element_id ) {
				continue;
			}

			$map[ $index ] = $element_id;
		}

		return $map;
	}

}
