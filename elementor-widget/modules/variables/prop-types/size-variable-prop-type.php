<?php

namespace ElementorPro\Modules\Variables\PropTypes;

use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\String_Prop_Type;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// TODO: deprecate in 3.36
class Size_Variable_Prop_Type extends String_Prop_Type {
	public static function get_key(): string {
		return 'global-size-variable';
	}
}
