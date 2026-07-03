<?php

namespace ElementorPro\Modules\AssetsManager\AssetTypes\EditorOneMenuItems;

use Elementor\Core\Admin\EditorOneMenu\Interfaces\Menu_Item_Interface;
use Elementor\Modules\EditorOne\Classes\Menu_Config;
use ElementorPro\Modules\AssetsManager\AssetTypes\AdminMenuItems\Custom_Icons_Promotion_Menu_Item;
use ElementorPro\Modules\AssetsManager\AssetTypes\Icons_Manager;

class Editor_One_Icons_Promotion extends Custom_Icons_Promotion_Menu_Item implements Menu_Item_Interface {

	public function get_position(): int {
		return 20;
	}

	public function get_slug(): string {
		return Icons_Manager::PROMOTION_MENU_SLUG;
	}

	public function get_parent_slug(): string {
		return Menu_Config::ELEMENTOR_MENU_SLUG;
	}

	public function get_label(): string {
		return esc_html__( 'Icons', 'elementor-pro' );
	}

	public function get_group_id(): string {
		return Menu_Config::CUSTOM_ELEMENTS_GROUP_ID;
	}
}
