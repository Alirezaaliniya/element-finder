<?php
namespace ElementorPro\Modules\Woocommerce\Tags;

use ElementorPro\Modules\DynamicTags\Tags\Base\Tag;
use ElementorPro\Modules\DynamicTags\Tags\Base\License_Meta_Trait;
use ElementorPro\Modules\Woocommerce\Module;
use ElementorPro\Modules\Woocommerce\Tags\Traits\Tag_Product_Id;
use ElementorPro\Modules\Woocommerce\Traits\Product_Id_Trait;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

abstract class Base_Tag extends Tag {

	use Tag_Product_Id;
	use Product_Id_Trait;
	use License_Meta_Trait;

	public function get_group() {
		return Module::WOOCOMMERCE_GROUP;
	}

	public function get_categories() {
		return [ \Elementor\Modules\DynamicTags\Module::TEXT_CATEGORY ];
	}

	protected function get_required_license_feature() {
		return Module::DYNAMIC_TAGS_LICENSE_FEATURE_NAME;
	}

	public function get_editor_config() {
		$conf = parent::get_editor_config();
		$conf['force_convert_to_atomic'] = true;
		return $conf;
	}
}
