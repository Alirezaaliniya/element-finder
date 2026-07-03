<?php

namespace ElementorPro\Modules\AtomicWidgets\Transformers;

use Elementor\Modules\AtomicWidgets\PropsResolver\Props_Resolver_Context;
use Elementor\Modules\AtomicWidgets\PropsResolver\Render_Props_Resolver;
use Elementor\Modules\AtomicWidgets\PropsResolver\Transformer_Base;
use ElementorPro\Modules\AtomicWidgets\PropTypes\Display_Conditions\Display_Conditions_Prop_Type;


if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Display_Conditions extends Transformer_Base {
	public function transform( $value, Props_Resolver_Context $context ) {
		return ! is_array( $value ) || empty( $value )
			? []
			: $value;
	}

	public static function extract_from_settings( $settings ) {
		$prop_key = Display_Conditions_Prop_Type::get_key();

		if ( ! isset( $settings[ $prop_key ]['value'] ) ) {
			return '[]';
		}

		$params = self::create_params_from_settings( $settings );
		$resolved = Render_Props_Resolver::for_settings()->resolve( ...$params );

		return [ json_encode( $resolved[ $prop_key ] ) ];
	}

	private static function create_params_from_settings( $settings ) {
		$prop_key = Display_Conditions_Prop_Type::get_key();
		$prop_type = Display_Conditions_Prop_Type::make();
		$value = $settings[ $prop_key ];
		$schema = [
			$prop_key => $prop_type,
		];
		$props = [
			$prop_key => $value,
		];

		return [ $schema, $props ];
	}
}
