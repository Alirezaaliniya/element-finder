<?php

namespace ElementorPro\Modules\Attributes\PropsResolver\Transformers\Settings;

use Elementor\Modules\AtomicWidgets\PropsResolver\Props_Resolver_Context;
use Elementor\Modules\AtomicWidgets\PropsResolver\Transformer_Base;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Pro_Attributes_Transformer extends Transformer_Base {
	public function transform( $value, Props_Resolver_Context $context ) {
		if ( ! is_array( $value ) ) {
			return null;
		}

		$result = implode( ' ', array_map( function ( $item ) {
			if ( ! $this->is_valid_attribute_item( $item ) ) {
				return '';
			}

			return $item['key'] . '="' . $item['value'] . '"';
		}, $value ) );

		return $result;
	}

	private function is_valid_attribute_item( $item ): bool {
		return isset( $item['key'], $item['value'] )
			&& '' !== $item['key']
			&& '' !== $item['value'];
	}
}
