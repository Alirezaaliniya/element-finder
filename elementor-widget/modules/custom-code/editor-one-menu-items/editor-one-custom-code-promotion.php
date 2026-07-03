<?php

namespace ElementorPro\Modules\CustomCode\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Interface;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\CustomCode\AdminMenuItems\Custom_Code_Promotion_Menu_Item;
use ElementorPro\Modules\CustomCode\Module;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Editor_One_Custom_Code_Promotion extends Custom_Code_Promotion_Menu_Item implements Menu_Item_Interface {

	public function get_position(): int {
		return 30;
	}

	public function get_slug(): string {
		return Module::PROMOTION_MENU_SLUG;
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_MENU_SLUG;
	}

	public function get_label(): string {
		return esc_html__( 'Code', 'elementor-pro' );
	}

	public function get_group_id(): string {
		return Menu_Config::CUSTOM_ELEMENTS_GROUP_ID;
	}
}

