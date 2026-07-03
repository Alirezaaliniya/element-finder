<?php

namespace ElementorPro\Modules\Popup\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Interface;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\Popup\AdminMenuItems\Popups_Promotion_Menu_Item;
use ElementorPro\Modules\Popup\Module;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Editor_One_Popups_Promotion extends Popups_Promotion_Menu_Item implements Menu_Item_Interface {

	public function get_position(): int {
		return 70;
	}

	public function get_slug(): string {
		return Module::PROMOTION_MENU_SLUG;
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_MENU_SLUG;
	}

	public function get_label(): string {
		return esc_html__( 'Popups', 'elementor-pro' );
	}

	public function get_group_id(): string {
		return Menu_Config::TEMPLATES_GROUP_ID;
	}
}

