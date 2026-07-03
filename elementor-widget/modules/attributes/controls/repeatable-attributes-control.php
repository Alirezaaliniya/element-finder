<?php
namespace ElementorPro\Modules\Attributes\Controls;

use Elementor\Modules\AtomicWidgets\Controls\Types\Repeatable_Control as Core_Repeatable_Control;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Repeatable_Attributes_Control extends Core_Repeatable_Control {
	private ?array $add_item_tooltip_props = null;

	public function set_addItemTooltipProps( array $props ): self {
		$this->add_item_tooltip_props = $props;

		return $this;
	}

	public function get_props(): array {
		$props = parent::get_props();

		if ( null !== $this->add_item_tooltip_props ) {
			$props['addItemTooltipProps'] = (object) $this->add_item_tooltip_props;
		}

		return $props;
	}
}


