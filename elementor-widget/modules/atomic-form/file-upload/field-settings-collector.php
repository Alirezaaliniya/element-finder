<?php
namespace ElementorPro\Modules\AtomicForm\File_Upload;

use Elementor\Modules\AtomicWidgets\PropsResolver\Render_Props_Resolver;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Field_Settings_Collector {

	public const FILE_UPLOAD_WIDGET_TYPE = 'e-form-file-upload';

	/**
	 * @return array<string, array> element_id => file upload field settings.
	 */
	public function collect( array $form_element ): array {
		$map = [];
		$this->walk( $form_element['elements'] ?? [], $map );

		return $map;
	}

	private function walk( array $elements, array &$map ): void {
		foreach ( $elements as $element ) {
			$widget_type = $element['widgetType'] ?? $element['elType'] ?? '';

			if ( self::FILE_UPLOAD_WIDGET_TYPE === $widget_type ) {
				$map[ $element['id'] ] = Render_Props_Resolver::for_settings()->resolve(
					File_Upload::get_props_schema(),
					$element['settings'] ?? []
				);
			}

			if ( ! empty( $element['elements'] ) ) {
				$this->walk( $element['elements'], $map );
			}
		}
	}
}
