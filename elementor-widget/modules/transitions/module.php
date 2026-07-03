<?php
namespace ElementorPro\Modules\Transitions;

use ElementorPro\Base\Module_Base;
use ElementorPro\License\API;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Module extends Module_Base {

	public function get_name() {
		return 'transitions';
	}

	private function is_transitions_active() {
		return API::is_licence_has_feature( 'transitions' );
	}

	public function __construct() {
		parent::__construct();

		if ( $this->is_transitions_active() ) {
			add_filter(
				'elementor/atomic-widgets/styles/transitions/allowed-properties',
				[ $this, 'extend_allowed_properties' ]
			);
		}
	}

	public function extend_allowed_properties( array $core_properties ): array {
		$pro_properties = [
			'margin',
			'margin-block-end',
			'margin-inline-start',
			'margin-inline-end',
			'margin-block-start',
			'padding',
			'padding-block-end',
			'padding-inline-start',
			'padding-inline-end',
			'padding-block-start',
			'flex',
			'flex-grow',
			'flex-shrink',
			'flex-basis',
			'width',
			'height',
			'max-height',
			'max-width',
			'min-height',
			'min-width',
			'top',
			'left',
			'bottom',
			'right',
			'z-index',
			'color',
			'font-size',
			'line-height',
			'letter-spacing',
			'word-spacing',
			'font-variation-settings',
			'-webkit-text-stroke-color',
			'background-color',
			'background-position',
			'box-shadow',
			'border',
			'border-radius',
			'border-color',
			'border-width',
			'opacity',
			'transform',
			'filter',
		];

		return array_merge( $core_properties, $pro_properties );
	}
}
