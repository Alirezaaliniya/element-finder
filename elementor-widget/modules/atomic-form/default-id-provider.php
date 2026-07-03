<?php
namespace ElementorPro\Modules\AtomicForm;

use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\String_Prop_Type;
use Elementor\Modules\Components\PropTypes\Overridable_Prop_Type;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Default_Id_Provider {
	public static function get_default_id( string $prefix ): string {
		return $prefix . substr( wp_unique_id( '-' ), 0, 5 );
	}

	public static function get_default_id_prop( string $prefix ): String_Prop_Type {
		return String_Prop_Type::make()->default( self::get_default_id( $prefix ) )->meta( Overridable_Prop_Type::ignore() );
	}
}
