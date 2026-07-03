<?php
namespace ElementorPro\Modules\DisplayConditions;

use Elementor\Modules\AtomicWidgets\Base\Atomic_Control_Base;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Display_Conditions_Control extends Atomic_Control_Base {
	private ?bool $disabled = null;

	public function get_type(): string {
		return 'display-conditions';
	}

	public function set_disabled( bool $disabled ): self {
		$this->disabled = $disabled;

		return $this;
	}

	public function get_props(): array {
		$props = [];

		if ( null !== $this->disabled ) {
			$props['disabled'] = $this->disabled;
		}

		return $props;
	}
}
