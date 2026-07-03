<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Form_File_Collector {
	public function collect( array $index_to_element_id ): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized,WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- Nonce is validated upstream by the controller; file fields are sanitized by wp_handle_upload() in the move step.
		$raw = $_FILES['form_fields'] ?? null;

		if ( ! is_array( $raw ) || empty( $raw['name'] ) ) {
			return [];
		}

		$by_element_id = [];

		foreach ( $raw['name'] as $index => $field_branch ) {
			$element_id = $index_to_element_id[ $index ] ?? null;
			if ( null === $element_id ) {
				continue;
			}

			foreach ( $this->files_for_index( $raw, $index ) as $file ) {
				$by_element_id[ $element_id ][] = $file;
			}
		}

		return $by_element_id;
	}

	private function files_for_index( array $raw, $index ): array {
		$value_branch = $raw['name'][ $index ]['value'] ?? null;

		if ( ! is_array( $value_branch ) ) {
			return [];
		}

		$files = [];
		foreach ( array_keys( $value_branch ) as $value_index ) {
			$files[] = new Form_File(
				(string) ( $raw['name'][ $index ]['value'][ $value_index ] ?? '' ),
				(string) ( $raw['type'][ $index ]['value'][ $value_index ] ?? '' ),
				(string) ( $raw['tmp_name'][ $index ]['value'][ $value_index ] ?? '' ),
				(int) ( $raw['error'][ $index ]['value'][ $value_index ] ?? UPLOAD_ERR_NO_FILE ),
				(int) ( $raw['size'][ $index ]['value'][ $value_index ] ?? 0 )
			);
		}

		return $files;
	}
}
