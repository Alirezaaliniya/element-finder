<?php

namespace ElementorPro\Modules\AtomicWidgets\PropTypes\Display_Conditions;

use Elementor\Modules\AtomicWidgets\PropTypes\Base\Array_Prop_Type;
use Elementor\Modules\AtomicWidgets\PropTypes\Contracts\Prop_Type;
use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\String_Prop_Type;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Condition_Group_Prop_Type extends Array_Prop_Type {
	public static function get_key(): string {
		return 'condition-group';
	}

	protected function define_item_type(): Prop_Type {
		return String_Prop_Type::make();
	}
}
