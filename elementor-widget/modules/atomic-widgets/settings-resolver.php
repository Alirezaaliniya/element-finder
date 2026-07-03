<?php
namespace ElementorPro\Modules\AtomicWidgets;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Settings_Resolver {
	public static function resolve( array $settings ): array {
		$resolved = [];

		foreach ( $settings as $key => $value ) {
			$resolved[ $key ] = static::resolve_value( $value );
		}

		return $resolved;
	}

	private static function resolve_value( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}

		if ( ! empty( $value['$$type'] ) && array_key_exists( 'value', $value ) ) {
			return static::resolve_value( $value['value'] );
		}

		return array_map( [ static::class, 'resolve_value' ], $value );
	}
}
