<?php

namespace ElementorPro\Modules\Popup\AdminMenuItems;

use Elementor\Core\Admin\Menu\Interfaces\Admin_Menu_Item;
use Elementor\TemplateLibrary\Source_Local;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Popups_Menu_Item implements Admin_Menu_Item {
	public function get_capability(): string {
		return 'publish_posts';
	}

	public function get_label(): string {
		return esc_html__( 'Popups', 'elementor-pro' );
	}

	public function get_parent_slug(): string {
		return Source_Local::ADMIN_MENU_SLUG;
	}

	public function get_position(): ?int {
		return null;
	}

	public function is_visible(): bool {
		return true;
	}
}
