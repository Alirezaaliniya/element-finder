<?php

namespace ElementorPro\Modules\AtomicWidgets\Transformers;

use Elementor\Modules\AtomicWidgets\PropsResolver\Props_Resolver_Context;
use Elementor\Modules\AtomicWidgets\PropsResolver\Transformer_Base;


if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Condition_Group extends Transformer_Base {
	public function transform( $conditions, Props_Resolver_Context $context ) {
		if ( ! is_array( $conditions ) || empty( $conditions ) ) {
			return null;
		}

		return array_map( function( $condition ) {
			return json_decode( $condition, true );
		}, $conditions );
	}
}
